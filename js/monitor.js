/**
 * @name monitor
 * @author steven o'riley
 * @desc the interface which allows test administrators to monitor the test, that is:
 *          allow subjects to access the test
 *              and stop any more subjects from accessing the test
 *          allow subjects to take the test
 *              and end tests
 *          access the output.json file created from each test
 * Each monitor schould receive the appropriate algorithm file required in order to properly authenticate with the server
 */

'use strict';

/* Flags */

let flags = {
    // Text on the buttons
    startAcceptingButtonText: "Start Accepting Subjects",
    stopAcceptingButtonText: "Stop Accepting Subjects",
    startTestingButtonText: "Begin Testing",
    stopTestingButtonText: "End Testing",
    startPracticeButtonText: "Start Practice",
    endPracticeButtonText: "End Practice"
};

/* End Flags */

// Used later by algorithmic authentication
let access_func = {};

(function() {

// Don't allow file uploading if a correct algorithm is already found
let alreadyUploaded = false;

// Monitor's id
let gid = Math.random();

// Buttons
let toggleUsers, toggleTest, togglePractice, killEverything;
let practiceRound = false;

// Output link
let endAnchor;

// When the window has finally loaded
function awake() {
    target(".hello").style.opacity = 1;
}

// When the window closes
function leaving() {
    // We're leaving!
    command("leave");
}

// Resets all data on the server
function kill_everything() {
    let yesno = confirm("Are you absolutely sure you would like to kill all clients, all cached client values, and all testing information?");
    if (yesno) {
        document.body.innerHTML = "";
        command("killEverything", function(text) {
            window.location.reload();
        });
    }
}

// Toggles testing
function toggle_test(e) {
    if (this.disabled)
        return;
    if (this.className == "startTest")
        start_test.call(this);
    else
        end_test.call(this);
}

// Toggles user acceptance
function toggle_users(e) {
    if (this.disabled)
        return;
    if (this.className == "beginUsers")
        begin_users.call(this);
    else
        end_users.call(this);
}

// Toggle practice mode
function toggle_practice(e) {
    if (this.disabled)
        return;
    
    if (this.className == "startPractice")
        start_practice.call(this);
    else
        end_practice.call(this);
}

// Start practice mode
function start_practice() {
    if (this.disabled)
        return;
    let self = this;
    this.disabled = true;
    
    command("startPractice", function(text) {
        if (text != "-") {
            self.disabled = false;
            self.innerHTML = flags.endPracticeButtonText;
            self.className = "endPractice"; 
        }
    });
}

// End practice mode
function end_practice() {
    if (this.disabled)
        return;
    let self = this;
    this.disabled = true;
    
    command("endPractice", function(text) {
        if (text != "-") {
            self.disabled = false;
            self.innerHTML = flags.startPracticeButtonText;
            self.className = "startPractice"; 
        }
    });
}

// When the beginUsers button is clicked
function begin_users() {
    if (this.disabled)
        return;
    let self = this;
    this.disabled = true;
    
    // Start accepting users
    command("startAccepting", function(text) {
        if (text != "-") {
            self.disabled = false;
            self.className = "endUsers";
            self.innerHTML = flags.stopAcceptingButtonText;
        }
    });
}

// When then endUsers button is clicked
function end_users() {
    if (this.disabled)
        return;
    let self = this;
    this.disabled = true;
    
    // Stop accepting users
    command("stopAccepting", function(text) {
        if (text != "-") {
            self.disabled = false;
            self.className = "beginUsers";
            self.innerHTML = flags.startAcceptingButtonText;
        }
    });
}

// When the startTest button is clicked
function start_test() {
    if (this.disabled)
        return;
    let self = this;
    this.disabled = true;
    
    // Start the test
    command("startTest", function(text) {
        if (text != "-") {
            self.disabled = false;
            self.innerHTML = flags.stopTestingButtonText;
            self.className = "endTest";
        }
    });
}

// When the endTest button is clicked
function end_test(e) {
    if (this.disabled)
        return;
    let self = this;
    this.disabled = true;
    
    // Stop the test
    command("endTest", function(text) {
        if (text != "-") {
            self.disabled = false;
            self.innerHTML = flags.startTestingButtonText;
            self.className = "startTest";
            
            // Show the output file link, if it isn't there already
            if (!endAnchor) {
                let container = target(".container");
                let d = create("div", { "text-align": "center" });
                
                endAnchor = document.createElement("a");
                endAnchor.target = "_blank";
                endAnchor.innerHTML = "output";
                container.appendChild(create("br"));
                
                d.appendChild(endAnchor);
                container.appendChild(d);
            }
            
            endAnchor.href = text;
        }
    });
}

/**
 * Pends the server for info about clients
 */
function pend() {
    ajax(`@${gid}&client_info`, function(json) {
        if (json != "-") {
            let clientInfo = target(".subjects");
            if (!clientInfo)
                return;
            let o = JSON.parse(json);
            
            let subjects_per_group = o.number_of_groups == 0 ? o.number_of_subjects :
                                     Math.floor(o.number_of_subjects / o.number_of_groups) == o.number_of_subjects / o.number_of_groups ? o.number_of_subjects / o.number_of_groups :
                                     `~${Math.floor(o.number_of_subjects / o.number_of_groups)}`;
            
            clientInfo.innerHTML = `Subjects in each group: <b>${subjects_per_group}</b><br />Groups: <b>${o.number_of_groups}</b><br />Current round: <b>${o.round}</b><br />Current period: <b>${o.iteration}</b>`;
        }
        
        pend();
    });
}

// When the authentication algorithm is loaded, and verified
function loaded() {
    // Hide the original text
    target(".hello").style.opacity = 0;
    
    let other_info = target(".other_info");
    
    other_info.style.display = "none";
    pend();
    
    // Make all the things, then add them to the main container
    let container = target(".container");
    let newStuff = create("div", { "opacity": 0, "transition": "opacity .5s", "text-align": "center" });
    killEverything = create("button");
    toggleUsers = create("button");
    toggleTest = create("button");
    togglePractice = create("button");
    
    killEverything.innerHTML = "Kill Everything";
    killEverything.className = "killEverything";
    
    toggleUsers.innerHTML = flags.startAcceptingButtonText;
    toggleUsers.className = "beginUsers";
    
    toggleTest.innerHTML = flags.startTestingButtonText;
    toggleTest.className = "startTest";
    
    togglePractice.innerHTML = flags.startPracticeButtonText;
    togglePractice.className = "startPractice";
    
    // Make them all disabled by default, so we can enable the ones that the server says are currently active
    toggleUsers.disabled = true;
    toggleTest.disabled = true;
    togglePractice.disabled = true;
    
    // Link the buttons to their click events
    toggleUsers.addEventListener("click", (e) => toggle_users.call(toggleUsers, e));
    toggleTest.addEventListener("click", (e) => toggle_test.call(toggleTest, e));
    togglePractice.addEventListener("click", (e) => toggle_practice.call(togglePractice, e));
    killEverything.addEventListener("click", (e) => kill_everything.call(killEverything, e));
    
    // Add all the things
    newStuff.appendChild(toggleUsers);
    newStuff.appendChild(create("br"));
    newStuff.appendChild(toggleTest);
    newStuff.appendChild(create("br"));
    newStuff.appendChild(togglePractice);
    newStuff.appendChild(create("br"));
    newStuff.appendChild(killEverything);
    
    // After the original text has fully faded...
    setTimeout(function() {
        // Show the new stuff
        container.appendChild(newStuff);
        container.removeChild(target(".hello"));
        
        // Enable the buttons that the server says are active
        command("checkStatus", function(text) {
            var sp = text.split(" ");
            
            if (sp.indexOf("accepting") == -1) {
                toggleUsers.innerHTML = flags.startAcceptingButtonText;
                toggleUsers.className = "beginUsers";
            }
            else {
                toggleUsers.innerHTML = flags.stopAcceptingButtonText;
                toggleUsers.className = "endUsers";
            }
            
            if (sp.indexOf("testing") == -1) {
                toggleTest.innerHTML = flags.startTestingButtonText;
                toggleTest.className = "startTest";
            }
            else {
                toggleTest.innerHTML = flags.stopTestingButtonText;
                toggleTest.className = "endTest";
            }
            
            if (sp.indexOf("practicing") == -1) {
                togglePractice.innerHTML = flags.startPracticeButtonText;
                togglePractice.className = "startPractice";
            }
            else {
                togglePractice.innerHTML = flags.endPracticeButtonText;
                flags.className = "endPractice";
            }
            toggleTest.disabled = false;
            toggleUsers.disabled = false;
            togglePractice.disabled = false;
            
            // Fade the new items in
            setTimeout(function() {
                newStuff.style.opacity = 1;
                setTimeout(function() {
                    other_info.style.display = "";
                }, 500);
            }, 300);
        });
    }, 1000);
}

/**
 * One of the most important methods in this file; authenticates with the server while querying it with a monitor command
 * @param query -> The server query, syntax is [query_label]&[options]
 * @param callback -> The function called after the client is authenticated and the query is evaluated
 *          The callback function is called with the returned server response; this will be '-' if authentication failed (and thence the query was ignored)
 */
function command(query, callback) {
    callback = callback || (() => {});
    
    ajax(`@${gid}&request`, function(text) {
        let code = access_func.evalCode(+text);
        ajax(`@${gid}&respond&m='${code}'?${query}`, function(text) {
            callback(text);
        });
    });
}

/**
 * Helper function for quickly submitting and receiving ajax requests
 */
function ajax(url, callback) {
    let aj = new XMLHttpRequest();
    aj.open("GET", `${url}&monitor`, true);
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
 * Creates an element with custom style attributes
 * @param id -> The name of the element to create
 * @param attribs -> The attributes to inject
 */
function create(id, attribs) {
    attribs = attribs || {};
    var el = document.createElement(id);
    for (var i in attribs)
        el.style[i] = attribs[i];
    return el;
}

// When a file is dropped into the window...
window.addEventListener("drop", function(e) {
    // Don't redirect the page
    e.preventDefault();
    if (alreadyUploaded)
        return;
    
    // Check if a file is actually being dragged
    if (e.dataTransfer && e.dataTransfer.files) {
        let f = e.dataTransfer.files[0];
        let reader = new FileReader(f);
        
        // Read the file
        reader.addEventListener("load", function() {
            try {
                // Check if it's a valid javascript algorithm
                // Note: Clients are not permitted to submit ajax requests, so this is a *safe* evaluation
                eval(reader.result);
                
                // Check and see if the server agrees with the validity of the algorithm
                command("test", function(text) {
                    // If not, *error sounds*
                    if (text == "-")
                        return;
                    
                    // If so, *ding ding* sounds
                    alreadyUploaded = true;
                    
                    // Initiate the page for monitor controls
                    if (text == "admin_contradiction")
                        target(".hello").innerHTML = "It seems as though someone else is already administering this test. Please either exit other monitor windows or restart the test server to resolve this.";
                    else
                        loaded();
                });
            }
            catch (ex) {
                // Just an invalid algorithm file in general...
                console.error("Invalid algorithm file");
            }
        });
        
        reader.readAsText(f);
    }
});

// Add all the events
window.addEventListener("dragover", function(e) {
    // (Don't redirect the page)
    e.preventDefault();
});
window.addEventListener("load", awake);
window.addEventListener("beforeunload", leaving);

}).call(window);