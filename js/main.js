/**
 * @name main
 * @author steven o'riley
 * @desc for the main handling of subjects in participatory games
 */

'use strict';

(function() {

let startYValue = 0;

// botSubject.html sets window.isBot before loading this file
let isBot = !!window.isBot;
let botBehavior = () => {
    return ['random', 'constant'][Math.floor(Math.random() * 2)];
};

/* Flags */

// Amount of time (in seconds) to give the user before either they have chosen a choice, or one is chosen for them
let waitTime = 1;

// Buttons
let switchButtonText = "SWITCH";
let switchButtonDisabledText = () => `(Switched)`;

/* End Flags */

// Each client has his/her own id
let gid = Math.random();
let real_id = 1;

if (/id=[0-9]+/.test(window.location.href))
    real_id = +window.location.href.match(/id=[0-9]+$/)[0].substring(3);

let currentChoice = 'random';

// Main chart
let chart;

// For drawing
let myData = [];

// product delivered from server
let x_visible_to_out_subjects = false;

let switchButton;
let global_f;

// The line to the server
let socket;
// Once the server has turned us away or killed us, stop reconnecting
let dead = false;

// Load the chart
function awake() {
    google.charts.load('current', { 'packages': ['corechart'] });
    google.charts.setOnLoadCallback(init);
}

// Initiate the chart and the display text
function init() {
    chart = new google.visualization.LineChart(target(".line_chart"));
    target(".welcome").style.opacity = 1;
}

/**
 * Open the socket to the server and join the test; reconnects (with the same id) if the line drops
 */
function connect() {
    socket = new WebSocket(`${window.location.protocol == "https:" ? "wss" : "ws"}://${window.location.host}/ws`);

    socket.addEventListener("open", () => send({ "type": "join", "id": gid, "realid": real_id }));
    socket.addEventListener("message", (e) => receive(JSON.parse(e.data)));
    socket.addEventListener("close", () => {
        if (!dead)
            setTimeout(connect, 1000);
    });
}

/**
 * Handle a server message
 */
function receive(o) {
    var message = o.message;

    // Clients not allowed, let the clients know the server isn't accepting them yet
    if (message == "clients_not_accepted") {
        dead = true;
        target(".line_chart").style.display = "none";
        target(".welcome").innerHTML = "Sorry, but subjects are currently not permitted to join this test. Try reloading the page or contacting your test administrator.";
    }

    // Testing has begun, so initiate testing for this client
    else if (message == "begin") {
        target(".welcome").style.opacity = 0;
        setTimeout(() => {
            target(".line_chart").style.display = "";
            drawData(o);
            requestGraphInfo();

            startTesting(o);
        }, 1000);
    }

    // Live graph information (sent whenever somebody in the grouping chooses)
    else if (message == "graph_info")
        updateData(o);

    // The iteration has passed, so move on to the next iteration
    else if (message == "round_passed") {
        drawData(o);
        requestGraphInfo();

        nextIter(o);
    }

    // The round has passed, so reset all iterations and go to the next round
    else if (message == "restart") {
        currentChoice = 'random';
        real_id = o.new_realid || real_id;

        myData = [];

        nextRound(o);
    }

    // The test is over, so end the test for this client
    else if (message == "end") {

    }

    // The test is over, and the administrator is responded to
    else if (message == "finalize_end")
        endGame(o);

    // Kills this client
    else if (message == "kill") {
        dead = true;
        document.body.innerHTML = "";
        window.location.reload();
    }
}

/**
 * Displays the user's current choice in the DOM
 */
let setCurrentChoice = () => {
    target(".current_choice").innerHTML = `Your current choice is <b>${currentChoice.toLowerCase() == 'random' ? "P" : "Q"}</b>`;
};

/**
 * Ask the server for the current graph information
 */
let requestGraphInfo = () => {
    send({ "type": "graph_info" });
};

/**
 * Updates the chart data in real time
 */
let updateData = (o) => {
    let player_choice = target(".player_choice"),
        payout = target(".payout");

    player_choice.innerHTML = `<b>${o.in}/${o.subjects}</b> in your group chose P`;
    payout.innerHTML = `Your actual payoff is ${approx(o.value)}; cumulative is ${approx(o.accumulation)}`;

    drawData(o);
};

/**
 * Begin testing, for this client
 */
let startTesting = (o) => {
    // Server-delivered options
    if (o.x_visible_to_out_subjects)
        x_visible_to_out_subjects = o.x_visible_to_out_subjects;

    // Make all the stuff
    setCurrentChoice();
    let welcome = target(".welcome");

    welcome.innerHTML = "";
    welcome.style.opacity = 1;

    switchButton = create("button");
    switchButton.innerHTML = typeof switchButtonText == "function" ? switchButtonText() : switchButtonText;

    // Add all the stuff
    welcome.appendChild(switchButton);
    welcome.style["text-align"] = "center";

    // Add choice event listener
    global_f = setupTimer();
    switchButton.addEventListener("click", () => {
        doSwitch();
        global_f();
    });

    if (isBot)
        botChoose(o);
};

/**
 * Go to the next iteration
 */
let nextIter = (o) => {
    switchButton.innerHTML = typeof switchButtonText == "function" ? switchButtonText() : switchButtonText;
    switchButton.disabled = false;

    global_f = setupTimer();

    if (isBot)
        botChoose(o);
};

/**
 * Go to the next round
 */
let nextRound = (o) => {
    target(".timer").innerHTML = "";
    target(".current_choice").innerHTML = "";
    target(".line_chart").style.display = "none";
    target(".payout").innerHTML = "";
    target(".player_choice").innerHTML = "";
    target(".welcome").innerHTML = `Now moving on to round ${o.round}`;
    target(".welcome").style.opacity = 0;

    setTimeout(() => {
        target(".welcome").style.opacity = 1;

        setTimeout(() => {
            setTimeout(() => {
                target(".line_chart").style.display = "";
                drawData(o);
                requestGraphInfo();

                startTesting(o);
            }, 1000);
        }, 3000);
    }, 300);
};

/**
 * Ends the game, or at least for this client
 */
let endGame = () => {
    dead = true;
    target(".timer").innerHTML = "";
    target(".current_choice").innerHTML = "";
    target(".welcome").innerHTML = "Thank you for participating. The test is over now.";
    target(".welcome").style.opacity = 1;
};

// Handle bot decision choosing
let botChoose = (o) =>{
    setTimeout(function() {
        let oldChoice = currentChoice;
        let _currentChoice = (botBehavior(o.value, o.average_value, o["new_offer"], o.accumulation) + "").toLowerCase();
        if (['random', 'constant'].indexOf(_currentChoice) == -1)
            throw `Invalid bot return choice: \'${_currentChoice}\'`;
        if (oldChoice != _currentChoice)
            switchButton.click();
        setCurrentChoice();
    }, 250 + Math.floor(Math.random() * 250));
};

/**
 * Sets up the countdown timer
 */
let setupTimer = () => {
    let timer = target(".timer");
    let count = waitTime;
    let setTimerText = () => { timer.innerHTML = `You have <b>${count}s</b> to switch or stay`; };
    setTimerText();

    let I;
    let f = () => {
        timer.innerHTML = "";
        clearInterval(I);
        submitChoice(currentChoice);
    };

    let h = () => {
        if (--count == 0)
            f();
        else
            setTimerText();
    };
    I = setInterval(h, 1000);

    return f;
};

/**
 * Switch the user's current choice
 */
function doSwitch() {
    if (switchButton.disabled)
        return;
    switchButton.disabled = true;
    switchButton.innerHTML = typeof switchButtonDisabledText == "function" ? switchButtonDisabledText() : switchButtonDisabledText;
    currentChoice = currentChoice == 'random' ? 'constant' : 'random';
    setCurrentChoice();
}

/**
 * Submits a choice to the server
 * @param choice -> [ 'random' | 'constant' ]
 */
let submitChoice = (choice) => {
    send({ "type": "submit", "choice": choice });
};

/**
 * Draws a set of data with size kx3
 * @param data -> The data to draw
 */
let drawData = (o) => {
    // o -> value, average
    let maxValue = myData.length + 3;
    let minValue = 0;//Math.max(1.0, maxValue - 30);
    let startValue = startYValue, surpassed = false;

    if (o)
        myData[Math.max(o.iteration - 1, 0)] = [o.value, o.rand, o.average_value];

    var chart_data = new google.visualization.DataTable();
    var options;

    var drawIter = maxValue - 1;

    // adding line values to the chart
    chart_data.addColumn('number', 'Period');
    chart_data.addColumn('number', 'Value (me)');
    if (x_visible_to_out_subjects)
        chart_data.addColumn('number', 'IN value (x)');
    chart_data.addColumn('number', 'Average Value (group)');

    chart_data.addColumn('number', 'Q Payout');
    chart_data.addColumn({ 'role': 'annotation', 'type': 'string' });

    var array = [], temp;

    // appending data to the chart
    for (var i = minValue; i <= maxValue; i++) {
        if (i >= myData.length - 1)
            temp = x_visible_to_out_subjects ? [ i + 1, null, null, null ] : [ i + 1, null, null ];
        else {
            temp = myData[i] || (x_visible_to_out_subjects ? [ i + 1, null, null, null ] : [ i + 1, null, null ]);
            temp = x_visible_to_out_subjects ? [ i + 1, temp[0], typeof temp[1] == "number" ? temp[1] : null, temp[2] == 0 ? null : temp[2] ] : [ i + 1, temp[0], temp[2] == 0 ? null : temp[2] ];

            if (!surpassed && temp[1] < startValue && i > minValue)
                surpassed = true;
        }
        if (o && o["const"]) {
            temp.push(o["const"]);
            temp.push(i == drawIter ? `${approx(o["const"])} - Q Payout` : null);
        }
        else {
            temp.push(null);
            temp.push(null);
        }
        array.push(temp);
    }

    chart_data.addRows(array);

    // line/series information
    var series = x_visible_to_out_subjects ? {
        0: { pointSize: 4 },
        1: { lineWidth: 2, lineDashStyle: [4, 4] },
        2: { lineWidth: 3 },
        3: { lineWidth: 2 },
    } : {
        0: { pointSize: 4 },
        1: { lineWidth: 3 },
        2: { lineWidth: 2 },
    };
    var colors = x_visible_to_out_subjects ? ['blue', 'lightblue', 'darkgreen', 'black'] : ['blue', 'darkgreen', 'black'];

    options = {
        title: "Your Data",
        series,
        hAxis: {
            title: "Period"
        },
        vAxis: {
            title: "Value"
        },
        legend: {
            position: "bottom"
        },
        colors
    };

    // change the uppermost viewport clamp on the graph if..
    // ..the max value of the current player's line goes above the graph
    if (!surpassed) {
        options.vAxis.viewWindow = {
            min: startValue
        };
    }
    // ..or the server requests a specific upper bound
    if (o && o.max) {
        options.vAxis.viewWindow = options.vAxis.viewWindow || {};
        options.vAxis.viewWindow.max = o.max;
    }

    // draw the chart
    if (chart)
        chart.draw(chart_data, options);
};

/**
 * Rounds a value to a selected number of digits (default: 3)
 */
let approx = (value, digits) => {
    digits = digits || 3;
    let n = Math.pow(10, digits);
    return Math.floor(value * n) / n;
};

/**
 * Helper function for sending a message to the server
 */
function send(message) {
    if (socket && socket.readyState == WebSocket.OPEN)
        socket.send(JSON.stringify(message));
}

/**
 * Helper function for targeting elements quickly
 */
function target(id) {
    return /^\./.test(id) ? document.getElementsByClassName(id.substring(1))[0] :
           /^#/.test(id) ? document.getElementById(id.substring(1)) :
           document.getElementsByTagName(id)[0];
}

/**
 * Creates an element with custom-defined attributes
 * @param id -> The name of the element
 * @param attribs -> The css style attributes to inject
 */
function create(id, attribs) {
    attribs = attribs || {};
    var el = document.createElement(id);
    for (var i in attribs)
        el.style[i] = attribs[i];
    return el;
}

// Redraw the graph on resize, as long as it's visible
function resized() {
    var lchart = target(".line_chart");
    if (lchart.style.display != "none")
        drawData();
}

// Space bar switches
function keyDown(e) {
    if (e.keyCode == 32 && switchButton) {
        e.preventDefault();
        switchButton.click();
    }
}

// Add events to all the things
window.addEventListener("load", awake);
window.addEventListener("resize", resized);
window.addEventListener("keydown", keyDown);

connect();

}).call(window);
