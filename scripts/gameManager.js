/**
 * @name game manager
 * @author steven o'riley
 * @desc handles all game-based server operations
 */

'use strict';

// Just some modules we need later
// ...for writing to files
let fs = require('fs');

// ...and handling options
let options = require('./getOptions');
// ...and for returning random/constant values
let choiceAlgorithms = require('./choiceAlgorithms')();
// ...and for various statistical functions
let stats = require("./stats");

// Amount of time (in milliseconds) to wait before an unresponsive client is removed from server cache
let killTimeout = options.killTimeout || 5000;

// clients has everyone in the test now,
// rawClientIds has the ids of everyone in the test,
// rawCachedIds has the ids of everyone who is allowed in the test after testing has started
let clients = [], rawClientIds = [], rawCachedIds = [];

let people_per_group = options.people_per_group;

// For storing authentication values to monitors with separate ids
let codes = {};

// For keeping track of inactive users
let clientTokens = {}, clientTimeouts = {};

// Although this is presumable,
// acceptClients -> Should clients be accepted into the test?
// testingInProgress -> Is testing in progress?
// oneSubmit -> Has anyone submitted yet?
let acceptClients = false, testingInProgress = false, oneSubmit = false;

// For keeping track of id_in clients' values
let allClientValues = {}, allClientSubmits = {};

// For sending a response back to the monitor when the test is over for all clients
let monResponse = [];

// Global test subject information
let currIter = 0, currRound = -1, currNumSubmitted = 0, goingToChangeRounds = false;

let iterationAmount = (options.number_of_iterations || 30) + 1;

// The output data (inputted to choiceAlgorithms, if you remember/have looked at the file)
let allData = {}, maxYValue = {};
let collectedData;

// "Player ID, Group ID, Choice, Payoff, Iteration, Round, Theta, X"
// (Player Identifer,) Player ID, Group ID, Choice (P or Q, 1 -> P, 0 -> Q), Payoff, Iteration, Round, Theta, X
let csvPlayers = {}, csvWrapper = {};
let practiceMode = false;

// Decides what data to hand out depending on a user id
let getPointer = (id, allObj, defaultObj) => {
    if (typeof id != "number" || typeof allObj == "undefined")
        return null;
    
    let groupNumber = getGroupNumber(id);
    
    if (!allObj[groupNumber])
        allObj[groupNumber] = typeof defaultObj == "function" ? defaultObj() : defaultObj instanceof Object ? defaultObj : {};
    return allObj[groupNumber];
};

// Converts a client id into a modulated id
let getModulatedId = (id) => {
    return Math.floor(+id - 1) % people_per_group + 1;
};
// Converts a client id into a group number
let getGroupNumber = (id) => {
    let mod = Math.floor(+id - 1) % people_per_group;
    return (Math.floor(+id - 1) - mod) / people_per_group + 1;
};

// Just some other information
let numberOfSubjects = 0, alreadyWritten = false;
let numberOfGroups = 0;
let allIdIn = {}, allIdOut = {};

let groups = {};

// Here we go...
/**
 * Handles a request which has been detected to be a game code
 */
let handleCode = (request, response, syncNumber) => {
    // Parsing...
    var id = request.url.match(/[0-9\.]+/)[0], group, mod;
    var command = request.url.match(/[a-zA-Z_]+/)[0];
    var message = (request.url.match(/&m=\'.*?\'/) || ["&m=''"])[0].substring(3);
    message = message.substring(1, message.length - 1);
    
    var quest = null;
    if (/\?[a-zA-Z]+/.test(request.url))
        quest = request.url.match(/\?[a-zA-Z]+/)[0].substring(1);
    
    let attribs = {};
    let temp = request.url;
    while (/&[a-zA-Z]+=\'.*?\'|&[a-zA-Z]+/.test(temp))
        temp = temp.replace(/&[a-zA-Z]+=\'.*?\'|&[a-zA-Z]+/g, function(m) {
            var name = m.match(/[a-zA-Z]+/)[0];
            var value = (m.match(/\'.*?\'/) || [''])[0];
            value = value.substring(1, value.length - 1);
            attribs[name] = value;
            return "";
        });
    
    let clientid = +attribs.realid || 0;
    
    let round_string = `Round ${currRound + 1}`;
    let iter_string = `Iteration ${currIter + 1}`;
    let prev_iter_string = `Iteration ${currIter}`;
    let startRound = currRound, startIter = currIter;
    
    // Check if a client isn't pending. If so, redo this method after some amount of time, when the client is probably pending
    if (("monitor" in attribs) && "sync" in attribs && clients.length != numberOfSubjects) {
        console.log("Client not found, retrying...");
        let limit_attempts_sync = syncNumber || options["max_sync_attempts"] || 5;
        if (limit_attempts_sync > 0)
            setTimeout(() => handleCode.call(window, request, response, limit_attempts_sync - 1), 300);
        else
            reassertClients();
    }
    
    if (!("monitor" in attribs)) {
        allData[round_string] = allData[round_string] || {};
        
        if (!clientid && id in rawClientIds)
            clientid = clients[rawClientIds.indexOf(id)].realid;
        
        if (!clientid) {
            response.writeHead(404);
            response.end("-");
            return;
        }
        else {
            group = getGroupNumber(+clientid);
            mod = getModulatedId(+clientid);
            
            allData[round_string] = allData[round_string] || {};
            allClientValues[round_string] = allClientValues[round_string] || {};
            allClientSubmits[round_string] = allClientSubmits[round_string] ||{};
            
            allIdIn[round_string] = allIdIn[round_string] || {};
            allIdOut[round_string] = allIdOut[round_string] || {};
            
            allData[round_string][group] = allData[round_string][group] || {};
            allClientValues[round_string][group] = allClientValues[round_string][group] || {};
            allClientSubmits[round_string][group] = allClientSubmits[round_string][group] || {};
            
            allIdIn[round_string][group] = allIdIn[round_string][group] || [];
            allIdOut[round_string][group] = allIdOut[round_string][group] || [];
        }
    }
    
    // Handle each code type
    (
        /* Monitor */
        // If the potential monitor requests an authentication value, give them one
        "request" in attribs ? () => {
            codes[id + ""] = Math.random() + "";
            response.writeHead(200, { "Content-Type": "text/plain" });
            response.end(codes[id + ""]);
        } :
        
        // Authenticate the potential monitor and then evaluate their query
        "respond" in attribs ? () => {
            response.writeHead(200, { "Content-Type": "text/plain" });
            
            // When they don't even try
            if (!codes[id + ""])
                response.end("-");
            
            var valid = (attribs['m'] == evalCode(+codes[id + ""]));
            
            // When they try but their authentication value is invalid
            if (!valid)
                response.end("-");
            else {
                // Alright, now check the monitor commands
                
                // Test to see if monitoring is allowed
                if (quest == "test") {
                    response.end("success");
                }
                // When the monitor leaves
                else if (quest == "leave") {
                    
                }
                // Kill everything
                else if (quest == "killEverything") {
                    // Note that 'acceptClients' is the only value not cleared
                    allData = {};
                    codes = {};
                    clientTokens = {};
                    clientTimeouts = {};
                    
                    if (clients.length != 0)
                        broadcast("kill");
                    
                    clients = [];
                    rawClientIds = [];
                    rawCachedIds = [];
                    
                    allClientValues = {};
                    allClientSubmits = {};
                    
                    monResponse = [];
                    currIter = 0;
                    currRound = -1;
                    currNumSubmitted = 0;
                    goingToChangeRounds = false;
                    
                    testingInProgress = false;
                    oneSubmit = false;
                    maxYValue = {};
                    
                    allData = {};
                    response.end("+");
                }
                // Get the status for testing and client acceptance
                else if (quest == "checkStatus") {
                    let arr = [];
                    if (acceptClients)
                        arr.push("accepting");
                    if (testingInProgress)
                        arr.push("testing");
                    if (practiceMode)
                        arr.push("practicing");
                    
                    response.end(arr.join(" "));
                }
                // Start practice mode
                else if (quest == "startPractice") {
                    practiceMode = true;
                    response.end("+");
                }
                // End practice mode
                else if (quest == "endPractice") {
                    practiceMode = false;
                    response.end("+");
                }
                // Start accepting clients
                else if (quest == "startAccepting") {
                    acceptClients = true;
                    response.end("+");
                }
                // Stop accepting clients
                else if (quest == "stopAccepting") {
                    acceptClients = false;
                    response.end("+");
                }
                // Start the test
                else if (quest == "startTest") {
                    rawCachedIds = cloneObj(rawClientIds);
                    round_string = `Round ${currRound + 2}`;
                    restartTest(round_string);
                    
                    // Let the clients know the test has started
                    broadcast((i, client) => {
                        let j = client.realid, group = getGroupNumber(j), cid = getModulatedId(j);
                        let data = allData[round_string][group], clientValues = allClientValues[round_string][group], id_in = allIdIn[round_string][group], id_out = allIdOut[round_string][group];
                        
                        return ({ "value": clientValues[cid] || 0, "average_value": stats.mu(clientValues['random']) || 0, "message": "begin", "iteration": data["iterations"], "in": id_in.length, "out": id_out.length, "subjects": id_in.length + id_out.length, "accumulation": clientValues[cid], "average_accumulation": 0, "const": clientValues['const'][cid], "rand": clientValues['rand'][cid] });
                    });
                    
                    response.end("+");
                }
                
                // Stop the test
                else if (quest == "endTest") {
                    // ...and let the clients know the test has ended
                    broadcast("end");
                    
                    if (rawCachedIds.length == 0)
                        response.end("#");
                    else
                        monResponse.push(response);
                }
                // When authentication is successful, but the query is invalid
                else
                    response.end("+");
            }
        } :
        
        /* Subject */
        
        // Put the subjects somewhere on the server
        command == "pend" ? () => {
            // ...only if subjects are allowed here
            if (rawCachedIds.indexOf(id) != -1 || acceptClients)
                addClient(id, response, clientid || 0);
            else
                response.end(JSON.stringify({ "message": "clients_not_accepted" }));
        } :
        
        // Return various info about all subjects
        command == "client_info" ? () => {
            response.end(jsonStringify({ "number_of_groups": Math.ceil(clients.length / people_per_group) || numberOfGroups, "number_of_subjects": rawCachedIds.length, "iteration": currIter + 1, "round": currRound + 1 }));
        } :
        
        // When a user lets the server know its still alive
        /**
         * P.S. Check out this logic: The user is only alive if it tells everyone it's alive
         * If it doesn't speak of its own existence, then it shouldn't exist in the first place
         * #servergoals
         */
        command == "alive" ? () => {
            if (killTimeout == "null") {
                response.writeHead(200, { "Content-Type": "text/plain" });
                response.end("+");
                return;
            }
            
            let kill = Math.random();
            if (clientTimeouts[id])
                clearTimeout(clientTimeouts[id]);
            clientTokens[id] = kill;
            
            clientTimeouts[id] = setTimeout(() => {
                if (clientTokens[id] == kill) {
                    let index = rawClientIds.indexOf(id);
                    let sindex = rawCachedIds.indexOf(id);
                    if (index != -1) {
                        rawClientIds.splice(index, 1);
                        clients.splice(index, 1);
                    }
                    if (sindex != -1) {
                        rawCachedIds.splice(sindex, 1);
                        numberOfSubjects = rawCachedIds.length;
                    }
                    
                    if (monResponse.length > 0 && rawCachedIds.length == 0)
                        monResponse.pop().end("#");
                }
            }, killTimeout);
            
            response.end("+");
        } :
        
        command == "submit" ? () => {
            if (rawCachedIds.indexOf(id) == -1 || !testingInProgress) {
                response.writeHead(404);
                response.end();
                return;
            }
            
            allClientSubmits[round_string][id] = allClientSubmits[round_string][id] || {};
            if (allClientSubmits[round_string][id][iter_string]) {
                response.writeHead(200, { "Content-Type": "text/plain" });
                response.end("");
                return;
            }
            allClientSubmits[round_string][id][iter_string] = true;
            
            let choice = attribs['choice'];
            let ind_in = allIdIn[round_string][group].indexOf(mod), ind_out = allIdOut[round_string][group].indexOf(mod);
            
            if (!oneSubmit)
                oneSubmit = true;
            
            validateInformationExistence(iter_string, round_string, group);
            
            allData[round_string][group][iter_string]["choice"][mod] = choice;
            
            if (choice == 'random') {
                if (ind_in == -1) {
                    allIdIn[round_string][group].push(mod);
                    allClientValues[round_string][group][mod] = allClientValues[round_string][group]['rand'][mod];
                    allClientValues[round_string][group]['random'].push(allClientValues[round_string][group]['rand'][mod]);
                }
                if (ind_out != -1) {
                    allIdOut[round_string][group].splice(ind_out, 1);
                    allClientValues[round_string][group]['constant'].splice(ind_out, 1);
                }
                
                allData[round_string][group][iter_string]['in'][mod] = allClientValues[round_string][group][mod];
            }
            else if (choice == 'constant') {
                if (ind_out == -1) {
                    allIdOut[round_string][group].push(mod);
                    allClientValues[round_string][group][mod] = allClientValues[round_string][group]['const'][mod];
                    allClientValues[round_string][group]['constant'].push(allClientValues[round_string][group]['const'][mod]);
                }
                if (ind_in != -1) {
                    allIdIn[round_string][group].splice(ind_in, 1);
                    allClientValues[round_string][group]['random'].splice(ind_in, 1);
                }
                
                allData[round_string][group][iter_string]['out'][mod] = allClientValues[round_string][group][mod];
            }
            
            allData[round_string][group][iter_string]["accumulation"][mod] = (allData[round_string][group][prev_iter_string] ? allData[round_string][group][prev_iter_string]["accumulation"][mod] || 0 : 0) + allClientValues[round_string][group][mod];
            allData[round_string][group][iter_string]["accumulation"]["values"].push(allData[round_string][group][iter_string]["accumulation"][mod]);
            
            allData[round_string][group][iter_string]["values"][mod] = allClientValues[round_string][group][mod];
            allData[round_string][group][iter_string]["values"]["values"].push(allClientValues[round_string][group][mod]);
            
            if (++currNumSubmitted == numberOfSubjects) {
                currNumSubmitted = 0;
                
                // Restarting the rounds
                if (++currIter >= iterationAmount && monResponse.length == 0) {
                    let rstring = `Round ${currRound + 2}`;
                    collectedData = collectedData || {};
                    collectedData[round_string] = cloneObj(allData[round_string]);
                    csvWrapper[round_string] = cloneObj(csvPlayers);
                    
                    let save = makeDataOutput(collectedData);
                    let outStr = `data/output${new Date().getTime()}.tmp.${getOutputLastName()}`;
                    
                    if (!fs.existsSync("data"))
                        fs.mkdirSync("data");
                    fs.writeFile(outStr, save);
                    
                    restartTest(rstring);
                    choiceAlgorithms['roundChanged']();
                    
                    let setOfNumbers = [];
                    
                    for (let i = 1; i <= numberOfSubjects; i++)
                        setOfNumbers.push(i);
                    
                    let groupAverage = {};
                    let groupMax = {};
                    for (let i = 1; i <= numberOfGroups; i++) {
                        groupAverage[i] = stats.mu(allClientValues[rstring][i]['random']) || 0;
                        groupMax[i] = stats.max(allClientValues[rstring][i]['random']) || 0;
                        maxYValue[i] = (!maxYValue[i] || groupMax[i] > maxYValue[i]) ? groupMax[i] : maxYValue[i];
                    }
                    
                    // Let the clients know the test has restarted
                    broadcast((i, client) => {
                        let j = client.realid, group = getGroupNumber(j), cid = getModulatedId(j);
                        let data = allData[rstring][group], clientValues = allClientValues[rstring][group], id_in = allIdIn[rstring][group], id_out = allIdOut[rstring][group];
                        
                        let clientAverage = groupAverage[group];
                        let clientMax = maxYValue[group];
                        
                        let newrid = setOfNumbers.splice(Math.floor(Math.random() * setOfNumbers.length), 1)[0];
                        
                        return ({ "value": options.initial_value, "average_value": clientAverage, "message": "restart", "new_realid": newrid, "iteration": data["iterations"], "round": currRound + 1, "in": id_in.length, "out": id_out.length, "subjects": id_in.length + id_out.length, "accumulation": options.initial_value, "average_accumulation": clientAverage, "max": clientMax, "const": clientValues['const'][cid], "rand": clientValues['rand'][cid] });
                    });
                }
                else {
                    let old_client_average = {};
                    
                    // Apply new variable choices to all groups, where g represents the current group
                    for (let g = 1; g <= numberOfGroups; g++) {
                        old_client_average[g] = stats.mu(allClientValues[round_string][g]['random']) || 0;
                        
                        allClientValues[round_string][g]['random'] = [];
                        allClientValues[round_string][g]['constant'] = [];
                        
                        allData[round_string][g] = allData[round_string][g] || {};
                        allData[round_string][g]["iterations"] = currIter;
                        
                        for (var i = 0; i < allIdIn[round_string][g].length; i++) {
                            let value = choiceAlgorithms['random'](allData[round_string][g], allIdIn[round_string][g][i], (g - 1) * people_per_group + allIdIn[round_string][g][i], g);
                            let alt = choiceAlgorithms['constant'](allData[round_string][g], allIdIn[round_string][g][i], (g - 1) * people_per_group + allIdIn[round_string][g][i], g);
                            
                            allClientValues[round_string][g]['random'].push(value);
                            allClientValues[round_string][g]['rand'][allIdIn[round_string][g][i]] = value;
                            allClientValues[round_string][g]['const'][allIdIn[round_string][g][i]] = alt;
                            
                            allData[round_string][g][iter_string]['rand'][allIdIn[round_string][g][i]] = value;
                            allData[round_string][g][iter_string]['const'][allIdIn[round_string][g][i]] = alt;
                            
                            allClientValues[round_string][g][allIdIn[round_string][g][i]] = value;
                        }
                        for (var i = 0; i < allIdOut[round_string][g].length; i++) {
                            let value = choiceAlgorithms['constant'](allData[round_string][g], allIdOut[round_string][g][i], (g - 1) * people_per_group + allIdOut[round_string][g][i], g);
                            let alt = choiceAlgorithms['random'](allData[round_string][g], allIdOut[round_string][g][i], (g - 1) * people_per_group + allIdOut[round_string][g][i], g);
                            
                            allClientValues[round_string][g]['constant'].push(value);
                            allClientValues[round_string][g]['const'][allIdOut[round_string][g][i]] = value;
                            allClientValues[round_string][g]['rand'][allIdOut[round_string][g][i]] = alt;
                            
                            allData[round_string][g][iter_string]['const'][allIdOut[round_string][g][i]] = value;
                            allData[round_string][g][iter_string]['rand'][allIdOut[round_string][g][i]] = alt;
                            
                            allData[round_string][g]
                            allClientValues[round_string][g][allIdOut[round_string][g][i]] = value;
                        }
                        
                        allData[round_string][g][iter_string]["average_new_offer"] = stats.mu(allClientValues[round_string][g]['random']) || 0;
                        allData[round_string][g][iter_string]["average_accumulation"] = stats.mu(allData[round_string][g][iter_string]["accumulation"]["values"]);
                        
                        if (monResponse.length > 0) {
                            allData[round_string][g]["number_of_clients"] = numberOfSubjects;
                            allData[round_string][g]["client_ids"] = rawCachedIds;
                        }
                    }
                    
                    if (monResponse.length > 0) {
                        testingInProgress = false;
                        
                        broadcast((i, client) => {
                            let j = client.realid, group = getGroupNumber(j), cid = getModulatedId(j);
                            let data = allData[round_string][group], clientValues = allClientValues[round_string][group], id_in = allIdIn[round_string][group], id_out = allIdOut[round_string][group];
                            
                            // (Player Identifer,) Player ID, Group ID, Choice (P or Q, 1 -> P, 0 -> Q), Payoff, Iteration, Round, Theta, X, x, Q
                            
                            csvPlayers[cid + " " + group + " " + (startIter + 1) + " " + (startRound + 1)] = `${cid},${group},${data[iter_string]['choice'][j] == 'random' ? 0 : 1},${data[iter_string]['values'][cid]},${data['iterations']},${startRound + 1},${choiceAlgorithms.getTheta(data['iterations'] - 1, group)},${old_client_average[group]},${practiceMode ? 1 : 0},${data[iter_string]['rand'][cid]},${data[iter_string]['const'][cid]}`;
                            
                            return "finalize_end";
                        });
                        csvWrapper[round_string] = cloneObj(csvPlayers);
                        
                        let string = makeDataOutput(collectedData);
                        let outStr = `data/output${new Date().getTime()}.${getOutputLastName()}`;
                        
                        if (!fs.existsSync("data"))
                            fs.mkdirSync("data");
                        
                        fs.writeFile(outStr, string, function() {
                            if (options.delete_previous_collective_data_logging_upon_data_write) {
                                collectedData = {};
                                allData = {};
                                csvWrapper = {};
                                csvPlayers = {};
                                currRound = -1;
                            }
                            
                            let rep = monResponse.pop();
                            rep.writeHead(200, { "Content-Type": "text/plain" });
                            rep.end(`/${outStr}`);
                        });
                    }
                    else {
                        let groupAverage = {};
                        let groupMax = {};
                        for (let i = 1; i <= numberOfGroups; i++) {
                            groupAverage[i] = stats.mu(allClientValues[round_string][i]['random']) || 0;
                            groupMax[i] = stats.max(allClientValues[round_string][i]['random']) || 0;
                            maxYValue[i] = (!maxYValue[i] || groupMax[i] > maxYValue[i]) ? groupMax[i] : maxYValue[i];
                        }
                        
                        broadcast((i, client) => {
                            let j = client.realid, group = getGroupNumber(j), cid = getModulatedId(j);
                            
                            validateInformationExistence(iter_string, round_string, group);
                            
                            let data = allData[round_string][group], clientValues = allClientValues[round_string][group], id_in = allIdIn[round_string][group], id_out = allIdOut[round_string][group];
                            let clientAverage = groupAverage[group];
                            let clientMax = maxYValue[group];
                            
                            // (Player Identifer,) Player ID, Group ID, Choice (P or Q, 1 -> P, 0 -> Q), Payoff, Iteration, Round, Theta, X, x, Q
                            
                            csvPlayers[cid + " " + group + " " + (currIter + 1) + " " + (currRound + 1)] = `${cid},${group},${data[iter_string]['choice'][cid] == 'random' ? 0 : 1},${clientValues[cid]},${data['iterations']},${currRound + 1},${choiceAlgorithms.getTheta(data['iterations'] - 1, group)},${data[iter_string]['average_new_offer']},${practiceMode ? 1 : 0},${data[iter_string]['rand'][cid]},${data[iter_string]['const'][cid]}`;
                            
                            let stuff = { "value": clientValues[cid], "average_value": clientAverage, "message": "round_passed", "accumulation": data[iter_string]["accumulation"][cid], "average_accumulation": data[iter_string]["average_accumulation"], "iteration": data["iterations"], "in": id_in.length, "out": id_out.length, "subjects": numberOfSubjects, "max": clientMax, "choice": data[iter_string]["choice"][cid], "const": clientValues["const"][cid], "rand": clientValues["rand"][cid] };
                            
                            return stuff;
                        });
                    }
                }
            }
            
            response.writeHead(200, { "Content-Type": "text/plain" });
            response.end("+");
        } :
        
        // For updating the graph as other players choose
        command == "graph_info" ? () => {
            if (rawCachedIds.indexOf(id) == -1) {
                response.writeHead(404);
                response.end();
            }
            else {
                let iter_string = `Iteration ${currIter + 1}`;
                let prev_iter_string = `Iteration ${currIter}`;
                
                response.end( jsonStringify((() => {
                    let j = clientid, group = getGroupNumber(j), cid = getModulatedId(j);
                    
                    validateInformationExistence(iter_string, round_string, group);
                    
                    let data = allData[round_string][group], clientValues = allClientValues[round_string][group], id_in = allIdIn[round_string][group], id_out = allIdOut[round_string][group];
                    let val = 0, accum = 0;
                    let new_max = stats.max(clientValues['random']);
                    
                    if (data[prev_iter_string]) {
                        val = data[prev_iter_string]['values'][cid];
                        accum = data[prev_iter_string]['accumulation'][cid];
                    }
                    
                    maxYValue[group] = (!maxYValue[group] || new_max > maxYValue[group]) ? new_max : maxYValue[group];
                    
                    let stuff = { "value": val, "average_value": stats.mu(clientValues['random']) || 0, "message": "graph_info", "accumulation": accum, "average_accumulation": data[iter_string]["average_accumulation"], "iteration": currIter + 1, "in": id_in.length, "out": id_out.length, "subjects": id_in.length + id_out.length, "choice": (id_in.indexOf(id) == -1 ? 'constant' : 'random'), "max": maxYValue[group], "const": clientValues["const"][cid], "rand": clientValues["rand"][cid] };
                    
                    return stuff;
                })()));
            }
        } :
        
        // A client has left, so remove their existence from this place
        command == "leave" ? () => {
            let ind = rawClientIds.indexOf(id);
            let cache_ind = rawCachedIds.indexOf(id);
            if (ind != -1) {
                clients.splice(ind, 1);
                rawClientIds.splice(ind, 1);
            }
            if (cache_ind != -1)
                rawCachedIds.splice(cache_ind, 1);
        } :
        () => { response.writeHead(404); response.end(); }
    )
    
    ();
    
};

let restartTest = (round_string) => {
    currIter = 0;
    
    let iter_string = `Iteration ${currIter + 1}`;
    
    ++currRound;
    testingInProgress = true;
    numberOfSubjects = rawCachedIds.length;
    numberOfGroups = Math.ceil(numberOfSubjects / people_per_group);
    
    allData[round_string] = allData[round_string] || {};
    allClientSubmits[round_string] = allClientSubmits[round_string] ||{};
    
    allClientValues = allClientValues || {};
    allClientValues[round_string] = allClientValues[round_string] || {};
    
    allIdIn = allIdIn || {};
    allIdIn[round_string] = allIdIn[round_string] || {};
    
    allIdOut = allIdOut || {};
    allIdOut[round_string] = allIdOut[round_string] || {};
    
    csvPlayers = {};
    
    // j is each group
    for (let j = 1; j <= numberOfGroups; j++)
        allData[round_string][j] = { "iterations": 0, "number_of_clients": 0, "client_ids": [] };
    
    // i is each group
    for (let i = 1; i <= numberOfGroups; i++) {
        allData[round_string][i] = {};
        allData[round_string][i][iter_string] = {};
        allData[round_string][i]["iterations"] = currIter;
        
        allClientValues[round_string] = allClientValues[round_string] || {};
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
        
        for (var j = 1; j <= Math.min(people_per_group, numberOfSubjects - (i - 1) * people_per_group); j++) {
            let value = choiceAlgorithms['random'](allData[round_string][i], j, (i - 1) * people_per_group + j, i);
            let alt = choiceAlgorithms['constant'](allData[round_string][i], j, (i - 1) * people_per_group + j, i);
            
            allClientValues[round_string][i]['random'].push(value);
            allClientValues[round_string][i][j] = value;
            
            allClientValues[round_string][i]['rand'][j] = value;
            allData[round_string][i][iter_string]['rand'][j] = value;
            
            allClientValues[round_string][i]['const'][j] = alt;
            allData[round_string][i][iter_string]['const'][j] = alt;
            
            allIdIn[round_string][i].push(j);
        }
    }
};

// Makes sure various items are in the current data set
let validateInformationExistence = (iter_string, round_string, group) => {
    allClientValues[round_string] = allClientValues[round_string] || {};
    allClientValues[round_string][group] = allClientValues[round_string][group] || {};
    allClientValues[round_string][group]['random'] = allClientValues[round_string][group]['random'] || [];
    allClientValues[round_string][group]['constant'] = allClientValues[round_string][group]['constant'] || [];
    allClientValues[round_string][group]['rand'] = allClientValues[round_string][group]['rand'] || {};
    allClientValues[round_string][group]['const'] = allClientValues[round_string][group]['const'] || {};
    
    allIdIn[round_string] = allIdIn[round_string] || {};
    allIdOut[round_string] = allIdOut[round_string] || {};
    
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

// If the pending status of all clients has interfered with the clients array...
let reassertClients = () => {
    // ...then recalculate the client id arrays
    rawClientIds = [];
    rawCachedIds = [];
    for (var i in clients) {
        rawClientIds.push(clients[i].id);
        rawCachedIds.push(clients[i].id);
    }
};

// Returnsthe extension name of the output data
let getOutputLastName = () => {
    return options.output_format;
};

// Turns the given data into a string based upon the options in config.json
let makeDataOutput = (data) => {
    if (options.output_format == "csv") {
        
        // Builds the output to .csv
        // (Player Identifer,) Player ID, Group ID, Choice (P or Q, 1 -> P, 0 -> Q), Payoff, Iteration, Round, Theta, X
        let s = "PlayerID,GroupID,Choice,Payoff,Period,Round,Theta,X,Practice,x,Q\n";
        let r = "";
        let organized = {};
        
        for (let i in csvWrapper) {
            organized[i] = organized[i] || {};
            
            for (let j in csvWrapper[i]) {
                let jsp = (j + "").split(" ");
                organized[i][jsp[0]] = organized[i][jsp[0]] || "";
                organized[i][jsp[0]] += csvWrapper[i][j] + "\n";
            }
        }
        
        for (let i in organized) {
            r += i + "\n" + s;
            for (let j in organized[i])
                r += organized[i][j];
        }
        
        return r;
    }
    else
        return jsonStringify(data);
};

// Send a message to all clients
/*
    Note that
        for (client of clients)
            client.respond(typeof message == "function" ? message([...]) : message);
    does not work for this task.
*/
function broadcast(message) {
    var func = typeof message == "function", ind = clients.length;
    
    while (clients.length) {
        // Get each client,
        var client = clients.pop();
        
        // and then respond to them
        var rawMessage = func ? message(--ind, client) : message;
        var out = typeof rawMessage == "object" ? jsonStringify(rawMessage) : jsonStringify({ "message": rawMessage });
        
        rawClientIds.pop();
        client.ponse.writeHead(200, { "Content-Type": "text/plain" });
        client.ponse.end(out);
    }
}

// Adds a client:Client to the clients array, and adds their id to each id array
function addClient(id, ponse, realid) {
    // Well, they showed up, so add their id into the cache
    var second_index = rawCachedIds.indexOf(id);
    if (second_index == -1)
        rawCachedIds.push(id);
    
    // But if they aren't here now, then they should be here. So add them
    var index = rawClientIds.indexOf(id);
    if (index == -1) {
        var client = new Client(id, ponse, realid);
        index = rawClientIds.length;
        rawClientIds.push(id);
        clients.push(client);
        
        return clients[index];
    }
    
    // They're here, and they're in the cache, so now they're out the door
    return clients[index];
}

// Client class
class Client {
    /**
     * @param id -> The id of the client
     * @param ponse -> The response variable linking the server to the client
     */
    constructor(id, ponse, realid) {
        this.id = id;
        this.realid = realid || 0;
        this.ponse = ponse;
    }
    
    /**
     * Respond to this client
     * @param message -> The message to respond with
     * @param dontRemoveFromGlobal -> Respond to them, but don't remove them from the server client list
     */
    respond(message, dontRemoveFromGlobal) {
        let removed = this.remove(dontRemoveFromGlobal);
        if (removed) {
            this.ponse.writeHead(200, { "Content-Type": "text/plain" });
            this.ponse.end(message);
        }
    }
    
    /**
     * Remove this client from all locations on the server
     * @param dontRemoveFromGlobal -> If true, this function returns whether or not a client should be removed. By default, it returns whether or not a client has been removed.
     */
    remove(dontRemoveFromGlobal) {
        let index = rawClientIds.indexOf(this.id);
        if (index == -1)
            return false;
        
        if (dontRemoveFromGlobal)
            return true;
        clients.splice(index, 1);
        rawClientIds.splice(index, 1);
        return true;
    }
}


/**
 * Never used, but useful; turns a string into delimited ascii character values
 */
function ascii(text) {
    var r = "";
    for (var i = 0; i < text.length; i++)
        r += "/" + text.charCodeAt(i);
    return r;
}

/**
 * Turns a set of delimited ascii character values into a regular string
 */
function unascii(text) {
    var r = "";
    text.replace(/\/[0-9]+/g, function(m) {
        r += String.fromCharCode(m.substring(1));
        return m;
    });
    return r;
}

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

/**
 * Runs the server algorithm on a client code for authentication.
 * Note: Must be the same as access_func.evalCode in algorithm.key
 */
let evalCode = function(code) {
    let u = 0.772313, Y = 0.95819;
    return _SHA256((Math.floor(_stats.N(u, Y)(code) * 10000) / 10000) + "");
};

// Stats functions which actually also exist in stats.js
// See that file for documentation
let _stats = {
    sum: (S) => S.length == 0 ? 0 : S.pop() + sum(S),
    mu: (S) => sum(S) / S.length,
    foldr: (S, func, curr) => S.length == 0 ? curr : (curr || []).push(func(S.pop())),
    sigma: (S) => {
        var avg = mu(S);
        return Math.sqrt( mu( foldr(S, (v) => Math.pow(v - avg, 2)) ) );
    },
    variance: (S) => Math.pow(sigma(S), 2),
    N: (u, Y) => u instanceof Array ? N(mu(u), Math.pow(sigma(u), 2)) :
            (x) => 1 / Math.sqrt(2 * Y * Math.PI) * Math.exp(-Math.pow(x - u, 2) / 2 / Y)
};

// Implementation of SHA256 by Angel Marin and Paul Johnston
function _SHA256(a){function d(a,b){var c=(65535&a)+(65535&b),d=(a>>16)+(b>>16)+(c>>16);return d<<16|65535&c}function e(a,b){return a>>>b|a<<32-b}function f(a,b){return a>>>b}function g(a,b,c){return a&b^~a&c}function h(a,b,c){return a&b^a&c^b&c}function i(a){return e(a,2)^e(a,13)^e(a,22)}function j(a){return e(a,6)^e(a,11)^e(a,25)}function k(a){return e(a,7)^e(a,18)^f(a,3)}function l(a){return e(a,17)^e(a,19)^f(a,10)}function m(a,b){var m,n,o,p,q,r,s,t,u,v,w,x,c=new Array(1116352408,1899447441,3049323471,3921009573,961987163,1508970993,2453635748,2870763221,3624381080,310598401,607225278,1426881987,1925078388,2162078206,2614888103,3248222580,3835390401,4022224774,264347078,604807628,770255983,1249150122,1555081692,1996064986,2554220882,2821834349,2952996808,3210313671,3336571891,3584528711,113926993,338241895,666307205,773529912,1294757372,1396182291,1695183700,1986661051,2177026350,2456956037,2730485921,2820302411,3259730800,3345764771,3516065817,3600352804,4094571909,275423344,430227734,506948616,659060556,883997877,958139571,1322822218,1537002063,1747873779,1955562222,2024104815,2227730452,2361852424,2428436474,2756734187,3204031479,3329325298),e=new Array(1779033703,3144134277,1013904242,2773480762,1359893119,2600822924,528734635,1541459225),f=new Array(64);a[b>>5]|=128<<24-b%32,a[(b+64>>9<<4)+15]=b;for(var u=0;u<a.length;u+=16){m=e[0],n=e[1],o=e[2],p=e[3],q=e[4],r=e[5],s=e[6],t=e[7];for(var v=0;v<64;v++)v<16?f[v]=a[v+u]:f[v]=d(d(d(l(f[v-2]),f[v-7]),k(f[v-15])),f[v-16]),w=d(d(d(d(t,j(q)),g(q,r,s)),c[v]),f[v]),x=d(i(m),h(m,n,o)),t=s,s=r,r=q,q=d(p,w),p=o,o=n,n=m,m=d(w,x);e[0]=d(m,e[0]),e[1]=d(n,e[1]),e[2]=d(o,e[2]),e[3]=d(p,e[3]),e[4]=d(q,e[4]),e[5]=d(r,e[5]),e[6]=d(s,e[6]),e[7]=d(t,e[7])}return e}function n(a){for(var c=Array(),d=(1<<b)-1,e=0;e<a.length*b;e+=b)c[e>>5]|=(a.charCodeAt(e/b)&d)<<24-e%32;return c}function o(a){a=a.replace(/\r\n/g,"\n");for(var b="",c=0;c<a.length;c++){var d=a.charCodeAt(c);d<128?b+=String.fromCharCode(d):d>127&&d<2048?(b+=String.fromCharCode(d>>6|192),b+=String.fromCharCode(63&d|128)):(b+=String.fromCharCode(d>>12|224),b+=String.fromCharCode(d>>6&63|128),b+=String.fromCharCode(63&d|128))}return b}function p(a){for(var b=c?"0123456789ABCDEF":"0123456789abcdef",d="",e=0;e<4*a.length;e++)d+=b.charAt(a[e>>2]>>8*(3-e%4)+4&15)+b.charAt(a[e>>2]>>8*(3-e%4)&15);return d}var b=8,c=0;return a=o(a),p(m(n(a),a.length*b))}

module.exports = {
    handleCode: handleCode
};