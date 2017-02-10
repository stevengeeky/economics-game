/**
 * @name bot
 * @author steven o'riley
 * @desc for the main handling of bots in participatory games
 */

'use strict';

(function() {

let startYValue = 0;

let isBot = true;
let botBehavior = () => {
    return ['random', 'constant'][Math.floor(Math.random() * 2)];
};

/* Flags */

// Amount of time (in seconds) to give the user before either they have chosen a choice, or one is chosen for them
let waitTime = 1;

// Buttons
let switchButtonText = "SWITCH";
let switchButtonDisabledText = () => `(Switched)`;

// Graph Flags
let graphMinValueSYAxis = null;
let graphMaxValueSYAxis = null;

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

// For checking to see if the current iteration has changed in between server pends
let iterId;

let switchButton;
let global_f;

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
 * Let the server know the client is still alive
 */
function still_alive() {
    ajax(`@${gid}&alive`);
    setTimeout(still_alive, 500);
}

/**
 * Pend for server responses
 */
function pend() {
    ajax(`@${gid}&pend`, (json) => {
        // Server made an error, so repend it
        if (!json) {
            pend();
            return;
        }
        
        // Get the server message
        var o = JSON.parse(json);
        var message = o.message;
        
        // Clients not allowed, let the clients know the server isn't accepting them yet
        if (message == "clients_not_accepted") {
            target(".line_chart").style.display = "none";
            target(".welcome").innerHTML = "Sorry, but subjects are currently not permitted to join this test. Try reloading the page or contacting your test administrator.";
            return;
        }
        
        // Testing has begun, so initiate testing for this client
        else if (message == "begin") {
            target(".welcome").style.opacity = 0;
            setTimeout(() => {
                target(".line_chart").style.display = "";
                drawData(o);
                
                iterId = Math.random();
                updateData(iterId);
                
                startTesting(o);
            }, 1000);
        }
        
        // The iteration has passed, so move on to the next iteration
        else if (message == "round_passed") {
            drawData(o);
            
            iterId = Math.random();
            updateData(iterId);
            
            nextIter(o);
        }
        
        // The round has passed, so reset all iterations and go to the next round
        else if (message == "restart") {
            currentChoice = 'random';
            real_id = o.new_realid || real_id;
            
            myData = [];
            
            nextRound(o, iterId);
        }
        
        // The test is over, so end the test for this client
        else if (message == "end") {
            
        }
        
        // The test is over, and the administrator is responded to
        else if (message == "finalize_end") {
            endGame(o);
            return;
        }
        
        // Kills this client
        else if (message == "kill") {
            document.body.innerHTML = "";
            window.location.reload();
            return;
        }
        
        // We just pended the server and got a response, so repend it for more responses
        pend();
    });
}

/**
 * Displays the user's current choice in the DOM
 */
let setCurrentChoice = () => {
    target(".current_choice").innerHTML = `Your current choice is <b>${currentChoice.toLowerCase() == 'random' ? "P" : "Q"}</b>`;
};

/**
 * Updates the chart data in real time
 */
let updateData = (id) => {
    // If true, the round has changed
    let player_choice = target(".player_choice"),
        payout = target(".payout");
    
    if (id != iterId)
        return;
    
    ajax(`@${gid}&graph_info`, (text) => {
        if (id != iterId)
            return;
        
        let o = JSON.parse(text);
        player_choice.innerHTML = `<b>${o.in}/${o.subjects}</b> in your group chose P`;
        payout.innerHTML = `Your actual payoff is ${approx(o.value)}; cumulative is ${approx(o.accumulation)}`;
        
        drawData(o);
        
        setTimeout(() => updateData(id), 400);
    });
};

/**
 * Begin testing, for this client
 */
let startTesting = (o) => {
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
let nextRound = (o, id) => {
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
                
                iterId = Math.random();
                updateData(iterId);
                
                startTesting(o);
            }, 1000);
        }, 3000);
    }, 300);
};

/**
 * Ends the game, or at least for this client
 */
let endGame = () => {
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
        if (['random', 'constant'].indexOf(currentChoice) == -1)
            throw `Invalid bot return choice: \'${currentChoice}\'`;
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
    ajax(`@${gid}&submit&choice='${choice}'`);
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
        myData[Math.max(o.iteration - 1, 0)] = [o.value, o.average_value];
    var chart_data = new google.visualization.DataTable();
    var options;
    
    /*var drawPos = 1;
    var drawIter = Math.round(Math.round((maxValue - minValue) * drawPos) + minValue);*/
    var drawIter = maxValue - 1;
    
    chart_data.addColumn('number', 'Period');
    chart_data.addColumn('number', 'Value (me)');
    chart_data.addColumn('number', 'Average Value (group)');
    
    chart_data.addColumn('number', 'Q Payout');
    chart_data.addColumn({ 'role': 'annotation', 'type': 'string' });
    
    var array = [], temp;
    
    for (var i = minValue; i <= maxValue; i++) {
        if (i >= myData.length - 1)
            temp = [ i + 1, null, null ];
        else {
            temp = myData[i] || [ i + 1, null, null ];
            temp = [ i + 1, temp[0], temp[1] == 0 ? null : temp[1] ];
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
    
    options = {
        title: "Your Data",
        series: {
            0: { pointSize: 4 },
            1: { pointSize: 3 },
            2: { lineWidth: 2 }
        },
        hAxis: {
            title: "Period"
        },
        vAxis: {
            title: "Value",
            
        },
        legend: {
            position: "bottom"
        },
        colors: ['blue', 'darkgreen', 'black']
    };
    if (!surpassed) {
        options.vAxis.viewWindow = {
            min: startValue
        };
    }
    if (o && o.max) {
        options.vAxis.viewWindow = options.vAxis.viewWindow || {};
        options.vAxis.viewWindow.max = o.max;
    }
    
    if (chart)
        chart.draw(chart_data, options);
};

/**
 * Draws a normal distribution curve onto the plot
 * @param u -> mu, the inputted mean for the curve
 * @param Y -> gamma, the inputted variance for the curve
 * @param args -> Any additional arguments, like the number of points, where the curve domain starts, and where it ends ('points', 'start', 'end')
 */
/*let drawN = (u, Y, args) => {
    args = args || {};
    var points = args.points || 1000, start = args.start || -10, end = args.end || 10;
    var N = stats.N(u, Y);
    
    var array = [['Time', `N(${mu}, ${gamma})(x)`]];
    for (var i = start; i <= end; i += (end - start) / points)
        array.push([i, N(i)]);
    
    var data = google.visualization.arrayToDataTable(array);
    
    var options = {
        //pointsVisible: true,
        title: "Normal Distribution Curve",
        curveType: "function",
        legend: {
            position: "right"
        }
    };
    
    if (chart)
        chart.draw(data, options);
};*/

/**
 * Rounds a value to a selected number of digits (default: 3)
 */
let approx = (value, digits) => {
    digits = digits || 3;
    let n = Math.pow(10, digits);
    return Math.floor(value * n) / n;
};

/**
 * Helper function for quickly submitting and receiving ajax requests
 */
function ajax(url, callback) {
    let aj = new XMLHttpRequest();
    aj.open("GET", `${url}&realid='${real_id}'`, true);
    aj.send();
    
    if (typeof callback == "function")
        aj.addEventListener("readystatechange", function() {
            if (aj.readyState == 4)
                callback.call(aj, aj.responseText);
        });
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

// Prevent the user from actually reloading with ctrl+r (f5 is ignored, however)
function keyDown(e) {
    if (e.keyCode == 32) {
        e.preventDefault();
        switchButton.click();
    }
}

// Add events to all the things
window.addEventListener("load", awake);
window.addEventListener("resize", resized);
window.addEventListener("keydown", keyDown);

still_alive();
pend();

}).call(window);