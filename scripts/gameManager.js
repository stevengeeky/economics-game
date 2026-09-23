/**
 * @name game manager
 * @author steven o'riley
 * @desc handles all game-based server operations
 *
 * This module knows nothing about http or sockets. app.js turns socket messages into calls on the
 * object returned by createGame(options), and every subject/monitor is represented here only by a
 * `send(message)` function. The game data structures, the round/iteration logic and the output
 * file format are the same as in the polling version.
 */

'use strict';

// Just some modules we need later
// ...for writing to files
let fs = require('fs');
let path = require('path');
// ...for monitor authentication
let crypto = require('crypto');

// ...and for returning random/constant values
let makeChoiceAlgorithms = require('./choiceAlgorithms');
// ...and for various statistical functions
let stats = require("./stats");

// "Player ID, Group ID, Choice, Payoff, Iteration, Round, Theta, X"
// (Player Identifer,) Player ID, Group ID, Choice (P or Q, 1 -> P, 0 -> Q), Payoff, Iteration, Round, Theta, X, Practice, x, Q
let CSV_HEADER = "GlobalID,PlayerID,GroupID,Choice,Payoff,Period,Round,Theta,X,Practice,x,Q\n";

/**
 * Creates a game
 * @param options -> the parsed config.json (see getOptions.js). `data_dir` may additionally be given
 *                   to say where output files are written (default: the data directory next to app.js)
 */
let createGame = (options) => {
    let choiceAlgorithms = makeChoiceAlgorithms();

    // Amount of time (in milliseconds) to wait before a disconnected subject is removed from server cache
    // ("null" -> laissez-faire server, never drop anybody)
    let killTimeout = options.killTimeout || 5000;

    let people_per_group = options.people_per_group;

    let iterationAmount = (options.number_of_iterations || 30) + 1;

    let dataDir = options.data_dir || path.join(__dirname, '..', 'data');

    // subjects has everyone connected to the test right now (id -> { id, realid, send }),
    // rawCachedIds has the ids of everyone who is allowed in the test after testing has started,
    // rawCachedLookupIds has the global (url) id each of them first joined with
    let subjects = new Map(), rawCachedIds = [], rawCachedLookupIds = [];

    // For dropping subjects whose connection went away
    let dropTimers = {};

    // For storing authentication values to monitors with separate ids
    let codes = {};

    // Monitors who want to be told whenever the client info changes
    let monitorListeners = new Set();

    // Although this is presumable,
    // acceptClients -> Should clients be accepted into the test?
    // testingInProgress -> Is testing in progress?
    let acceptClients = false, testingInProgress = false;
    let practiceMode = false;

    // For keeping track of id_in clients' values
    let allClientValues = {}, allClientSubmits = {};

    // For sending a response back to the monitor when the test is over for all clients
    let monResponse = [];

    // Global test subject information
    let currIter = 0, currRound = -1, currNumSubmitted = 0;

    // The output data (inputted to choiceAlgorithms, if you remember/have looked at the file)
    let allData = {}, maxYValue = {};
    let collectedData;

    let csvPlayers = {}, csvWrapper = {};

    // Just some other information
    let numberOfSubjects = 0;
    let numberOfGroups = 0;
    let allIdIn = {}, allIdOut = {};

    // Converts a client id into a modulated id
    let getModulatedId = (id) => {
        return Math.floor(+id - 1) % people_per_group + 1;
    };
    // Converts a client id into a group number
    let getGroupNumber = (id) => {
        let mod = Math.floor(+id - 1) % people_per_group;
        return (Math.floor(+id - 1) - mod) / people_per_group + 1;
    };

    // The global id (the url id a subject first joined with) of a subject
    let globalId = (id) => rawCachedLookupIds[rawCachedIds.indexOf(id)];

    // Whether a subject is currently out
    let isOut = (round_string, group, mod) => !!(allIdOut[round_string] && allIdOut[round_string][group] && allIdOut[round_string][group].indexOf(mod) != -1);

    /* Talking to subjects and monitors */

    // Send a message to one subject. Unless config.json says otherwise, subjects who are out don't get to see x
    let sendTo = (subject, message) => {
        let out = Object.assign({}, message);
        if (!options.x_visible_to_out_subjects && isOut(`Round ${currRound + 1}`, getGroupNumber(subject.realid), getModulatedId(subject.realid)))
            delete out.rand;
        subject.send(out);
    };

    // Send a message to all subjects; message may be a function of the subject, an object, or a plain message string
    let broadcast = (message) => {
        for (let subject of subjects.values()) {
            let rawMessage = typeof message == "function" ? message(subject) : message;
            sendTo(subject, typeof rawMessage == "object" ? rawMessage : { "message": rawMessage });
        }
    };

    // Various info about all subjects, for the monitor
    let clientInfo = () => ({ "number_of_groups": Math.ceil(rawCachedIds.length / people_per_group) || numberOfGroups, "number_of_subjects": rawCachedIds.length, "iteration": currIter + 1, "round": currRound + 1 });

    // Let every listening monitor know the client info changed
    let notifyMonitors = () => {
        let info = clientInfo();
        for (let send of monitorListeners)
            send(Object.assign({ "message": "client_info" }, info));
    };

    /* Subjects */

    /**
     * A subject shows up (or comes back)
     * @param id -> The subject's id (unique per page load)
     * @param realid -> The subject's url id
     * @param send -> How to talk to the subject
     * @returns whether the subject was let in
     */
    let join = (id, realid, send) => {
        // ...only if subjects are allowed here
        if (rawCachedIds.indexOf(id) == -1 && !acceptClients)
            return false;

        if (dropTimers[id]) {
            clearTimeout(dropTimers[id]);
            delete dropTimers[id];
        }

        // Well, they showed up, so add their id into the cache
        if (rawCachedIds.indexOf(id) == -1) {
            rawCachedIds.push(id);
            rawCachedLookupIds.push(realid);
        }

        // If they were here before (reconnect), the server's idea of their id in the current round wins
        let subject = subjects.get(id);
        if (subject) {
            subject.send = send;
            subject.realid = subject.realid || realid || 0;
        }
        else
            subjects.set(id, { "id": id, "realid": realid || 0, "send": send });

        notifyMonitors();
        return true;
    };

    // Remove a subject from all locations on the server
    let removeSubject = (id) => {
        subjects.delete(id);
        let sindex = rawCachedIds.indexOf(id);
        if (sindex != -1) {
            rawCachedIds.splice(sindex, 1);
            rawCachedLookupIds.splice(sindex, 1);
            numberOfSubjects = rawCachedIds.length;
        }

        if (monResponse.length > 0 && rawCachedIds.length == 0)
            monResponse.pop()("#");

        notifyMonitors();
    };

    // A subject's connection went away. After killTimeout, if they haven't come back, drop them
    let disconnect = (id) => {
        subjects.delete(id);
        if (killTimeout == "null" || rawCachedIds.indexOf(id) == -1)
            return;

        if (dropTimers[id])
            clearTimeout(dropTimers[id]);
        dropTimers[id] = setTimeout(() => {
            delete dropTimers[id];
            if (!subjects.has(id))
                removeSubject(id);
        }, killTimeout);
    };

    // A subject has left, so remove their existence from this place
    let leave = (id) => {
        if (dropTimers[id]) {
            clearTimeout(dropTimers[id]);
            delete dropTimers[id];
        }
        removeSubject(id);
    };

    // Makes sure the storage objects for a subject's round/group exist
    let ensureStorage = (round_string, group) => {
        allData[round_string] = allData[round_string] || {};
        allClientValues[round_string] = allClientValues[round_string] || {};
        allClientSubmits[round_string] = allClientSubmits[round_string] || {};

        allIdIn[round_string] = allIdIn[round_string] || {};
        allIdOut[round_string] = allIdOut[round_string] || {};

        allData[round_string][group] = allData[round_string][group] || {};
        allClientValues[round_string][group] = allClientValues[round_string][group] || {};
        allClientSubmits[round_string][group] = allClientSubmits[round_string][group] || {};

        allIdIn[round_string][group] = allIdIn[round_string][group] || [];
        allIdOut[round_string][group] = allIdOut[round_string][group] || [];
    };

    /**
     * A subject submits a decision
     * @param id -> The subject's id
     * @param choice -> [ 'random' | 'constant' ]
     * @returns whether the decision was accepted
     */
    let submit = (id, choice) => {
        let subject = subjects.get(id);
        if (!subject || rawCachedIds.indexOf(id) == -1 || !testingInProgress)
            return false;
        if (choice != 'random' && choice != 'constant')
            return false;

        let clientid = subject.realid;
        if (!clientid)
            return false;

        // Visual information
        let round_string = `Round ${currRound + 1}`;
        let iter_string = `Iteration ${currIter + 1}`;
        let prev_iter_string = `Iteration ${currIter}`;
        let startIter = currIter, startRound = currRound;

        // associated client attributes, i.e.
        let group = getGroupNumber(+clientid);  // group id
        let mod = getModulatedId(+clientid);    // id in that group

        ensureStorage(round_string, group);

        allClientSubmits[round_string][id] = allClientSubmits[round_string][id] || {};
        // if the client already made a decision, ignore this new request
        if (allClientSubmits[round_string][id][iter_string])
            return true;
        allClientSubmits[round_string][id][iter_string] = true;

        // one of these, in or out, will be -1; the one that isn't is where the client was last round
        let ind_in = allIdIn[round_string][group].indexOf(mod), ind_out = allIdOut[round_string][group].indexOf(mod);

        validateInformationExistence(iter_string, round_string, group);

        allData[round_string][group][iter_string]["choice"][mod] = choice;

        // if the client made a random choice now...
        if (choice == 'random') {
            // if they weren't in, make them in
            if (ind_in == -1) {
                allIdIn[round_string][group].push(mod);
                allClientValues[round_string][group][mod] = allClientValues[round_string][group]['rand'][mod];
                allClientValues[round_string][group]['random'].push(allClientValues[round_string][group]['rand'][mod]);
            }
            // if they were out, make them not out
            if (ind_out != -1) {
                allIdOut[round_string][group].splice(ind_out, 1);
                allClientValues[round_string][group]['constant'].splice(ind_out, 1);
            }

            allData[round_string][group][iter_string]['in'][mod] = allClientValues[round_string][group][mod];
        }
        // if the client made a constant choice now...
        else {
            // if they weren't out, make them out
            if (ind_out == -1) {
                allIdOut[round_string][group].push(mod);
                allClientValues[round_string][group][mod] = allClientValues[round_string][group]['const'][mod];
                allClientValues[round_string][group]['constant'].push(allClientValues[round_string][group]['const'][mod]);
            }
            // if they were in, make them not in
            if (ind_in != -1) {
                allIdIn[round_string][group].splice(ind_in, 1);
                allClientValues[round_string][group]['random'].splice(ind_in, 1);
            }

            allData[round_string][group][iter_string]['out'][mod] = allClientValues[round_string][group][mod];
        }

        // update information about the client's accumulation, as well as locally global
        // accumulation information about all current iteration client values
        allData[round_string][group][iter_string]["accumulation"][mod] = (allData[round_string][group][prev_iter_string] ? allData[round_string][group][prev_iter_string]["accumulation"][mod] || 0 : 0) + allClientValues[round_string][group][mod];
        allData[round_string][group][iter_string]["accumulation"]["values"].push(allData[round_string][group][iter_string]["accumulation"][mod]);

        // update iteration value information, about this client
        allData[round_string][group][iter_string]["values"][mod] = allClientValues[round_string][group][mod];
        // ..and about all clients
        allData[round_string][group][iter_string]["values"]["values"].push(allClientValues[round_string][group][mod]);

        // if all clients have submitted a decision..
        if (++currNumSubmitted >= numberOfSubjects) {
            currNumSubmitted = 0;

            // Restart the round if we've gone through all iterations
            if (++currIter >= iterationAmount && monResponse.length == 0)
                nextRound(round_string);
            // if we haven't gone through all of our iterations, go to the next iteration
            else
                nextIteration(round_string, iter_string, startIter, startRound);

            notifyMonitors();

            // everyone's graph changed
            if (testingInProgress)
                for (let other of subjects.values())
                    pushGraphInfo(other);
        }
        // otherwise the graphs of everyone in this grouping changed
        else
            for (let other of subjects.values())
                if (getGroupNumber(other.realid) == group)
                    pushGraphInfo(other);

        return true;
    };

    /**
     * Go to the next round, for use after all iterations of a round have passed
     * @param round_string -> The string representing the round that just ended; looks like 'Round #'
     */
    let nextRound = (round_string) => {
        // temporarily updated round string
        let rstring = `Round ${currRound + 2}`;
        collectedData = collectedData || {};
        collectedData[round_string] = cloneObj(allData[round_string]);
        csvWrapper[round_string] = cloneObj(csvPlayers);

        // write temporary data information
        writeOutput(`output${new Date().getTime()}.tmp.${getOutputLastName()}`, makeDataOutput(collectedData));

        // officially restart the test and reset choice information (random/constant values for each client)
        restartTest(rstring);
        choiceAlgorithms['roundChanged']();

        // randomize the list of subjects
        let setOfNumbers = [];
        let constants = options.constant_groups || [];

        for (let i = 1; i <= numberOfSubjects; i++) {
            // if the subject is in the list of groups that are set to remain constant, don't randomize it
            if (constants.indexOf(getGroupNumber(i)) != -1)
                continue;
            setOfNumbers.push(i);
        }

        // calculate basic initial stat information about all clients
        let groupAverage = {};
        let groupMax = {};
        for (let i = 1; i <= numberOfGroups; i++) {
            groupAverage[i] = stats.mu(allClientValues[rstring][i]['random']) || 0;
            groupMax[i] = stats.max(allClientValues[rstring][i]['random']) || 0;
            maxYValue[i] = (!maxYValue[i] || groupMax[i] > maxYValue[i]) ? groupMax[i] : maxYValue[i];
        }

        // Let the clients know the test has restarted
        broadcast((subject) => {
            let j = subject.realid, group = getGroupNumber(j);

            let newrid = constants.indexOf(group) != -1 ? j : setOfNumbers.splice(Math.floor(Math.random() * setOfNumbers.length), 1)[0];
            // this is the subject's id from now until the next round
            subject.realid = newrid || j;

            let ngroup = getGroupNumber(subject.realid), cid = getModulatedId(subject.realid);
            let data = allData[rstring][ngroup], clientValues = allClientValues[rstring][ngroup], id_in = allIdIn[rstring][ngroup], id_out = allIdOut[rstring][ngroup];

            let clientAverage = groupAverage[ngroup];
            let clientMax = maxYValue[ngroup];

            // again, return important information personalized to each client
            // this time also deliver what the subject's new realid is

            return ({ "value": options.initial_value || 0, "average_value": clientAverage, "message": "restart", "new_realid": subject.realid, "iteration": data["iterations"], "round": currRound + 1, "in": id_in.length, "out": id_out.length, "subjects": id_in.length + id_out.length, "accumulation": options.initial_value || 0, "average_accumulation": clientAverage, "max": clientMax, "const": clientValues['const'][cid], "rand": clientValues['rand'][cid], "x_visible_to_out_subjects": options.x_visible_to_out_subjects || false });
        });
    };

    /**
     * Go to the next iteration (or finish the game, if the monitor asked for that), for use after all subjects have submitted
     * @param round_string -> The string representing the current round; looks like 'Round #'
     * @param iter_string -> The string representing the iteration that just ended; looks like 'Iteration #'
     */
    let nextIteration = (round_string, iter_string, startIter, startRound) => {
        let old_client_average = {};

        // Apply new variable choices to all groups, where g represents the current group
        for (let g = 1; g <= numberOfGroups; g++) {
            old_client_average[g] = stats.mu(allClientValues[round_string][g]['random']) || 0;

            // reset random/constant value choices
            allClientValues[round_string][g]['random'] = [];
            allClientValues[round_string][g]['constant'] = [];

            // reset global information about each group
            allData[round_string][g] = allData[round_string][g] || {};
            allData[round_string][g]["iterations"] = currIter;

            // new iteration, new choices for everyone
            for (let i = 0; i < allIdIn[round_string][g].length; i++) {
                // for everyone who is in, give them new random/constant values to choose from
                let value = choiceAlgorithms['random'](allData[round_string][g], allIdIn[round_string][g][i], (g - 1) * people_per_group + allIdIn[round_string][g][i], g);
                let alt = choiceAlgorithms['constant'](allData[round_string][g], allIdIn[round_string][g][i], (g - 1) * people_per_group + allIdIn[round_string][g][i], g);

                allClientValues[round_string][g]['random'].push(value);
                allClientValues[round_string][g]['rand'][allIdIn[round_string][g][i]] = value;
                allClientValues[round_string][g]['const'][allIdIn[round_string][g][i]] = alt;

                // global information about choices available to each client
                allData[round_string][g][iter_string]['rand'][allIdIn[round_string][g][i]] = value;
                allData[round_string][g][iter_string]['const'][allIdIn[round_string][g][i]] = alt;

                allClientValues[round_string][g][allIdIn[round_string][g][i]] = value;
            }
            for (let i = 0; i < allIdOut[round_string][g].length; i++) {
                // for everyone who is out, give them new random/constant values to choose from
                let value = choiceAlgorithms['constant'](allData[round_string][g], allIdOut[round_string][g][i], (g - 1) * people_per_group + allIdOut[round_string][g][i], g);
                let alt = choiceAlgorithms['random'](allData[round_string][g], allIdOut[round_string][g][i], (g - 1) * people_per_group + allIdOut[round_string][g][i], g);

                allClientValues[round_string][g]['constant'].push(value);
                allClientValues[round_string][g]['const'][allIdOut[round_string][g][i]] = value;
                allClientValues[round_string][g]['rand'][allIdOut[round_string][g][i]] = alt;

                // global information about choices available to each client
                allData[round_string][g][iter_string]['const'][allIdOut[round_string][g][i]] = value;
                allData[round_string][g][iter_string]['rand'][allIdOut[round_string][g][i]] = alt;

                allClientValues[round_string][g][allIdOut[round_string][g][i]] = value;
            }

            // basic stat information about initial choices
            allData[round_string][g][iter_string]["average_new_offer"] = stats.mu(allClientValues[round_string][g]['random']) || 0;
            allData[round_string][g][iter_string]["average_accumulation"] = stats.mu(allData[round_string][g][iter_string]["accumulation"]["values"]);

            // if the test is about to be over, finally give information about the number of subjects/available ids in the test
            if (monResponse.length > 0) {
                allData[round_string][g]["number_of_clients"] = numberOfSubjects;
                allData[round_string][g]["client_ids"] = rawCachedIds;
            }
        }

        // end the game
        if (monResponse.length > 0) {
            testingInProgress = false;

            broadcast((subject) => {
                let j = subject.realid, group = getGroupNumber(j), cid = getModulatedId(j);
                let gid = globalId(subject.id);

                let data = allData[round_string][group];

                // Append information to the output csv object
                // (Player Identifer,) Player ID, Group ID, Choice (P or Q, 1 -> P, 0 -> Q), Payoff, Iteration, Round, Theta, X, x, Q

                csvPlayers[gid + " " + (currIter + 1) + " " + (currRound + 1)] = `${gid},${cid},${group},${data[iter_string]['choice'][cid] == 'random' ? 0 : 1},${data[iter_string]['values'][cid]},${data['iterations']},${startRound + 1},${choiceAlgorithms.getTheta(data['iterations'] - 1, group)},${old_client_average[group]},${practiceMode ? 1 : 0},${data[iter_string]['rand'][cid]},${data[iter_string]['const'][cid]}`;

                return "finalize_end";
            });
            // csvWrapper contains the csv information from all rounds
            csvWrapper[round_string] = cloneObj(csvPlayers);

            // write the output csv file
            let string = makeDataOutput(collectedData);
            let outStr = `output${new Date().getTime()}.${getOutputLastName()}`;

            writeOutput(outStr, string, () => {
                if (options.delete_previous_collective_data_logging_upon_data_write) {
                    collectedData = {};
                    allData = {};
                    csvWrapper = {};
                    csvPlayers = {};
                    currRound = -1;
                }

                // tell the monitor where the output game data is stored
                while (monResponse.length > 0)
                    monResponse.pop()(`/data/${outStr}`);
                notifyMonitors();
            });
        }
        // game isn't over, so just store csv information/tell each client the iteration has changed
        else {
            let groupAverage = {};
            let groupMax = {};

            // update groupAverage/groupMax information to deliver to clients
            for (let i = 1; i <= numberOfGroups; i++) {
                groupAverage[i] = stats.mu(allClientValues[round_string][i]['random']) || 0;
                groupMax[i] = stats.max(allClientValues[round_string][i]['random']) || 0;
                maxYValue[i] = (!maxYValue[i] || groupMax[i] > maxYValue[i]) ? groupMax[i] : maxYValue[i];
            }

            // broadcast information to all clients
            broadcast((subject) => {
                let j = subject.realid, group = getGroupNumber(j), cid = getModulatedId(j);
                let gid = globalId(subject.id);

                validateInformationExistence(iter_string, round_string, group);

                let data = allData[round_string][group], clientValues = allClientValues[round_string][group], id_in = allIdIn[round_string][group], id_out = allIdOut[round_string][group];
                let clientAverage = groupAverage[group];
                let clientMax = maxYValue[group];

                // store the following csv information:
                // (Player Identifer,) Player ID, Group ID, Choice (P or Q, 1 -> P, 0 -> Q), Payoff, Iteration, Round, Theta, X, x, Q

                csvPlayers[gid + " " + (currIter + 1) + " " + (currRound + 1)] = `${gid},${cid},${group},${data[iter_string]['choice'][cid] == 'random' ? 0 : 1},${clientValues[cid]},${data['iterations']},${currRound + 1},${choiceAlgorithms.getTheta(data['iterations'] - 1, group)},${data[iter_string]['average_new_offer']},${practiceMode ? 1 : 0},${data[iter_string]['rand'][cid]},${data[iter_string]['const'][cid]}`;

                // deliver game product information to each client

                return { "value": clientValues[cid], "average_value": clientAverage, "message": "round_passed", "accumulation": data[iter_string]["accumulation"][cid], "average_accumulation": data[iter_string]["average_accumulation"], "iteration": data["iterations"], "in": id_in.length, "out": id_out.length, "subjects": numberOfSubjects, "max": clientMax, "choice": data[iter_string]["choice"][cid], "const": clientValues["const"][cid], "rand": clientValues["rand"][cid] };
            });
        }
    };

    /**
     * Graph information for one subject, for updating the graph as other players choose
     * @param id -> The subject's id
     * @returns the graph information, or null if the subject isn't in the test
     */
    let graphInfo = (id) => {
        let subject = subjects.get(id);
        if (!subject || rawCachedIds.indexOf(id) == -1 || !subject.realid || currRound < 0)
            return null;

        let round_string = `Round ${currRound + 1}`;
        let iter_string = `Iteration ${currIter + 1}`;
        let prev_iter_string = `Iteration ${currIter}`;

        let j = subject.realid, group = getGroupNumber(j), cid = getModulatedId(j);

        validateInformationExistence(iter_string, round_string, group);

        let data = allData[round_string][group], clientValues = allClientValues[round_string][group], id_in = allIdIn[round_string][group], id_out = allIdOut[round_string][group];
        let val = 0, accum = 0;
        let new_max = stats.max(clientValues['random']);

        // if previous iteration data is available, graph the list of values and previous accumulation information from there
        if (data[prev_iter_string]) {
            val = data[prev_iter_string]['values'][cid];
            accum = data[prev_iter_string]['accumulation'][cid];
        }

        maxYValue[group] = (!maxYValue[group] || new_max > maxYValue[group]) ? new_max : maxYValue[group];

        // deliver graph information to each client

        return { "value": val, "average_value": stats.mu(clientValues['random']) || 0, "message": "graph_info", "accumulation": accum, "average_accumulation": data[iter_string]["average_accumulation"], "iteration": currIter + 1, "in": id_in.length, "out": id_out.length, "subjects": id_in.length + id_out.length, "choice": (id_in.indexOf(cid) == -1 ? 'constant' : 'random'), "max": maxYValue[group], "const": clientValues["const"][cid], "rand": clientValues["rand"][cid] };
    };

    // Send a subject their graph information
    let pushGraphInfo = (subject) => {
        let info = graphInfo(subject.id);
        if (info)
            sendTo(subject, info);
    };

    /* Monitor */

    /**
     * A potential monitor requests an authentication value; give them one
     * @param id -> The monitor's id
     */
    let requestCode = (id) => {
        codes[id + ""] = Math.random() + "";
        return codes[id + ""];
    };

    /**
     * Authenticate the potential monitor and then evaluate their query.
     * This is where the monitor control panel buttons get linked to
     * @param id -> The monitor's id
     * @param m -> The monitor's answer to the authentication value (see algorithm.key)
     * @param quest -> The query
     * @param reply -> Called with the response text; '-' if authentication failed (and thence the query was ignored)
     */
    let command = (id, m, quest, reply) => {
        // When they don't even try
        if (!codes[id + ""])
            return reply("-");

        let valid = (m == evalCode(+codes[id + ""]));

        // When they try but their authentication value is invalid
        if (!valid)
            return reply("-");

        // Test to see if monitoring is allowed
        if (quest == "test")
            reply("success");
        // When the monitor leaves
        else if (quest == "leave")
            reply("+");
        // Kill everything
        else if (quest == "killEverything") {
            // Note that 'acceptClients' is the only value not cleared
            // every other value is cleared, clients get sent a message telling them the test has been killed
            codes = {};

            if (subjects.size != 0)
                broadcast("kill");

            for (let i in dropTimers)
                clearTimeout(dropTimers[i]);
            dropTimers = {};

            subjects = new Map();
            rawCachedIds = [];
            rawCachedLookupIds = [];

            allClientValues = {};
            allClientSubmits = {};
            allIdIn = {};
            allIdOut = {};

            while (monResponse.length > 0)
                monResponse.pop()("#");
            currIter = 0;
            currRound = -1;
            currNumSubmitted = 0;
            numberOfSubjects = 0;
            numberOfGroups = 0;

            testingInProgress = false;
            maxYValue = {};

            allData = {};
            collectedData = undefined;
            csvPlayers = {};
            csvWrapper = {};

            notifyMonitors();
            reply("+");
        }
        // Get the status of the game for testing and client acceptance
        else if (quest == "checkStatus") {
            let arr = [];
            if (acceptClients)
                arr.push("accepting");
            if (testingInProgress)
                arr.push("testing");
            if (practiceMode)
                arr.push("practicing");

            reply(arr.join(" "));
        }
        // Start practice mode
        else if (quest == "startPractice") {
            practiceMode = true;
            reply("+");
        }
        // End practice mode
        else if (quest == "endPractice") {
            practiceMode = false;
            reply("+");
        }
        // Start accepting clients
        else if (quest == "startAccepting") {
            acceptClients = true;
            reply("+");
        }
        // Stop accepting clients
        else if (quest == "stopAccepting") {
            acceptClients = false;
            reply("+");
        }
        // Start the test
        else if (quest == "startTest") {
            if (testingInProgress)
                return reply("+");

            let round_string = `Round ${currRound + 2}`;
            choiceAlgorithms['roundChanged']();
            restartTest(round_string);

            // Let the clients know the test has started
            broadcast((subject) => {
                // For each client, send them back a list of important information
                // This information is broadcasted for each new iteration, and for each new round
                let j = subject.realid, group = getGroupNumber(j), cid = getModulatedId(j);

                let data = allData[round_string][group], clientValues = allClientValues[round_string][group], id_in = allIdIn[round_string][group], id_out = allIdOut[round_string][group];

                // Broadcast... the client's current iteration value, the average value of
                // all clients who are in, a message saying 'begin' the test, what iteration we
                // are on, how many are in, how many are out, how many subjects there are, how
                // much the current client has gained across all iterations thus far, the
                // average accumulation of all clients, what the current client's constant
                // choice is, and what the current client's random choice is

                return ({ "value": clientValues[cid] || 0, "average_value": stats.mu(clientValues['random']) || 0, "message": "begin", "iteration": data["iterations"], "in": id_in.length, "out": id_out.length, "subjects": id_in.length + id_out.length, "accumulation": clientValues[cid], "average_accumulation": 0, "const": clientValues['const'][cid], "rand": clientValues['rand'][cid], "x_visible_to_out_subjects": options.x_visible_to_out_subjects || false });
            });

            notifyMonitors();
            reply("+");
        }
        // Stop the test
        else if (quest == "endTest") {
            // ...and let the clients know the test has ended
            broadcast("end");

            if (rawCachedIds.length == 0 || !testingInProgress)
                reply("#");
            // the reply arrives once the current iteration has ended and the output file is written
            else
                monResponse.push(reply);
        }
        // When authentication is successful, but the query is invalid
        else
            reply("+");
    };

    // A monitor wants the client info now, and whenever it changes
    let watch = (send) => {
        monitorListeners.add(send);
        send(Object.assign({ "message": "client_info" }, clientInfo()));
    };

    // ...and no longer
    let unwatch = (send) => {
        monitorListeners.delete(send);
    };

    /**
     * Restart the test, for use after each round
     * @param round_string -> The string representing the current round; looks like 'Round #'
     */
    let restartTest = (round_string) => {
        currIter = 0;
        currNumSubmitted = 0;

        let iter_string = `Iteration ${currIter + 1}`;

        // We're going to the next round
        ++currRound;
        testingInProgress = true;

        // Update global info about the test
        numberOfSubjects = rawCachedIds.length;
        numberOfGroups = Math.ceil(numberOfSubjects / people_per_group);

        // New round, new data to collect; create a storage place for it
        allData[round_string] = allData[round_string] || {};
        allClientSubmits[round_string] = allClientSubmits[round_string] || {};

        // ..that includes all client id_in/id_out value choices...
        allClientValues[round_string] = allClientValues[round_string] || {};

        // ..and who is in
        allIdIn[round_string] = allIdIn[round_string] || {};

        // ..and who is out
        allIdOut[round_string] = allIdOut[round_string] || {};

        // and information to append to the output csv
        csvPlayers = {};

        // i is each group
        for (let i = 1; i <= numberOfGroups; i++) {
            // expose data storage locations for each round, for each group; similar to validateInformationExistence
            allData[round_string][i] = {};
            allData[round_string][i][iter_string] = {};
            allData[round_string][i]["iterations"] = currIter;

            allClientValues[round_string][i] = {};
            allIdIn[round_string][i] = [];
            allIdOut[round_string][i] = [];

            allClientValues[round_string][i]['random'] = [];
            allClientValues[round_string][i]['constant'] = [];

            allClientValues[round_string][i]['rand'] = {};
            allClientValues[round_string][i]['const'] = {};

            allData[round_string][i][iter_string]['rand'] = {};
            allData[round_string][i][iter_string]['const'] = {};

            // j is each subject
            // for each subject in the ith group..
            for (let j = 1; j <= Math.min(people_per_group, numberOfSubjects - (i - 1) * people_per_group); j++) {
                // give the jth subject a random and constant value to choose from
                let value = choiceAlgorithms['random'](allData[round_string][i], j, (i - 1) * people_per_group + j, i);
                let alt = choiceAlgorithms['constant'](allData[round_string][i], j, (i - 1) * people_per_group + j, i);

                allClientValues[round_string][i]['random'].push(value);
                allClientValues[round_string][i][j] = value;

                allClientValues[round_string][i]['rand'][j] = value;
                allData[round_string][i][iter_string]['rand'][j] = value;

                allClientValues[round_string][i]['const'][j] = alt;
                allData[round_string][i][iter_string]['const'][j] = alt;

                // by default, make all players be in
                allIdIn[round_string][i].push(j);
            }
        }
    };

    // Makes sure various items are in the current data set
    let validateInformationExistence = (iter_string, round_string, group) => {
        // the following appears complicated but each dimension represents a new revision requested by JP
        // for each round...
        //      for each group...
        //          for each iteration...
        //              [some information stored in this iteration]
        // make sure that each part of the hierarchy is set to an empty object, so that information can be
        // set later

        allClientValues[round_string] = allClientValues[round_string] || {};
        allClientValues[round_string][group] = allClientValues[round_string][group] || {};
        allClientValues[round_string][group]['random'] = allClientValues[round_string][group]['random'] || [];
        allClientValues[round_string][group]['constant'] = allClientValues[round_string][group]['constant'] || [];
        allClientValues[round_string][group]['rand'] = allClientValues[round_string][group]['rand'] || {};
        allClientValues[round_string][group]['const'] = allClientValues[round_string][group]['const'] || {};

        allIdIn[round_string] = allIdIn[round_string] || {};
        allIdOut[round_string] = allIdOut[round_string] || {};
        allIdIn[round_string][group] = allIdIn[round_string][group] || [];
        allIdOut[round_string][group] = allIdOut[round_string][group] || [];

        allData[round_string] = allData[round_string] || {};
        allData[round_string][group] = allData[round_string][group] || {};
        allData[round_string][group][iter_string] = allData[round_string][group][iter_string] || { "visible_average": stats.mu(allClientValues[round_string][group]['random']) || 0 };
        allData[round_string][group][iter_string]['rand'] = allData[round_string][group][iter_string]['rand'] || {};
        allData[round_string][group][iter_string]['const'] = allData[round_string][group][iter_string]['const'] || {};

        allData[round_string][group][iter_string]['in'] = allData[round_string][group][iter_string]['in'] || {};
        allData[round_string][group][iter_string]['out'] = allData[round_string][group][iter_string]['out'] || {};
        allData[round_string][group][iter_string]['accumulation'] = allData[round_string][group][iter_string]['accumulation'] || {};
        allData[round_string][group][iter_string]['accumulation']["values"] = allData[round_string][group][iter_string]['accumulation']["values"] || [];
        allData[round_string][group][iter_string]["choice"] = allData[round_string][group][iter_string]["choice"] || {};
        allData[round_string][group][iter_string]["values"] = allData[round_string][group][iter_string]["values"] || {};
        allData[round_string][group][iter_string]["values"]["values"] = allData[round_string][group][iter_string]["values"]["values"] || [];
    };

    // Returns the extension name of the output data
    let getOutputLastName = () => {
        return options.output_format;
    };

    // Writes an output file into the data directory
    let writeOutput = (name, string, callback) => {
        if (!fs.existsSync(dataDir))
            fs.mkdirSync(dataDir, { "recursive": true });
        fs.writeFile(path.join(dataDir, name), string, (err) => {
            if (err)
                console.error(`could not write ${name}: ${err.message}`);
            if (callback)
                callback();
        });
    };

    // Turns the given data into a string based upon the options in config.json
    let makeDataOutput = (data) => {
        if (options.output_format == "csv") {

            // Builds the output to .csv
            // (Player Identifer,) Player ID, Group ID, Choice (P or Q, 1 -> P, 0 -> Q), Payoff, Iteration, Round, Theta, X
            let s = CSV_HEADER;
            let r = "";
            let organized = {};

            // cid + " " + group + " " + (startIter + 1) + " " + (startRound + 1)
            // O(n) sorting algorithm to sort by global id
            for (let i in csvWrapper) {
                organized[i] = organized[i] || [];

                for (let j in csvWrapper[i]) {
                    let jsp = (j + "").split(" ");
                    organized[i][jsp[0]] = organized[i][jsp[0]] || "";
                    organized[i][jsp[0]] += csvWrapper[i][j] + "\n";
                }
            }

            // Append all the output csv information to the output string
            for (let i in organized) {
                r += i + "\n" + s;
                for (let j in organized[i])
                    r += organized[i][j];
            }

            return r;
        }
        else
            return jsonStringify(data);     // by default, return data in raw json format
    };

    /**
     * Runs the server algorithm on a client code for authentication.
     * Note: Must be the same as access_func.evalCode in algorithm.key
     */
    let evalCode = function(code) {
        let u = 0.772313, Y = 0.95819;
        return crypto.createHash('sha256').update((Math.floor(stats.N(u, Y)(code) * 10000) / 10000) + "").digest('hex');
    };

    return {
        // subjects
        "join": join,
        "disconnect": disconnect,
        "leave": leave,
        "submit": submit,
        "graphInfo": graphInfo,
        // monitors
        "requestCode": requestCode,
        "command": command,
        "clientInfo": clientInfo,
        "watch": watch,
        "unwatch": unwatch
    };
};

/**
 * Since JSON.stringify does not handle mulilayer explicit variables defined after-the-fact, this function is needed.
 * @param json -> The json to stringify
 */
let jsonStringify = function(json, indent) {
    indent = indent || "";

    var r = "{\n";

    for (var i in json) {
        var data = json[i];
        var rl = r.length;

        r += (rl == 2 ? "" : ",\n") + indent + "    " + `\"${(i + "").replace(/\"/g, "\\\"")}\": `;
        r += (
            data instanceof Array ? arr_to_str(data, indent + "    ")
            : typeof data == "string" ? `\"${data.replace(/\"/g, "\\\"")}\"`
            : typeof data == "object" ? jsonStringify(data, indent + "    ")
            : typeof data == "undefined" ? "\"undefined\""
            : data
        );
    }

    return r + "\n" + indent + "}";
};

/**
 * Clones a json object o
 */
let cloneObj = (o) => {
    if (o instanceof Array) {
        let r = [];
        for (let i = 0; i < o.length; i++)
            r.push(cloneObj(o[i]));
        return r;
    }
    else if (typeof o == "object") {
        let r = {};
        for (let i in o)
            r[cloneObj(i)] = cloneObj(o[i]);
        return r;
    }

    return o;
};

/**
 * Turns an array into a string
 */
let arr_to_str = function(a, indent) {
    indent = indent || "";

    let r = "[";
    for (let i = 0; i < a.length; i++) {
        let data = a[i];
        r += (r == "[" ? "\n" : ",\n") + indent + "    ";
        r += (
            data instanceof Array ? arr_to_str(data, indent + "    ")
            : typeof data == "string" ? `\"${data.replace(/\"/g, "\\\"")}\"`
            : typeof data == "object" ? jsonStringify(data, indent + "    ")
            : typeof data == "undefined" ? "\"undefined\""
            : data
        );
    }
    return r + "\n" + indent + "]";
};

module.exports = createGame;
