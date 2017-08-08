/**
 * @name main server file
 * @author steven o'riley
 * @desc the main server file; handles all server-side attributes
 */

'use strict';

// For server request/response handling
let http = require('http');

// For user-option handling
let options = require('./scripts/getOptions');

// For piping pages or feeding data to the client
let fs = require('fs');

// For stat-related operations
let stats = require('./scripts/stats');

// For parsing game server commands
let gameManager = require('./scripts/gameManager');

let PORT = options.PORT == "process.env.PORT" ? process.env.PORT || 3000 : (options.PORT || process.env.PORT || 3000);

/**
 * Main server feed, handles all server-based client requests
 */
let P = (request, response) => (
(
    // Don't handle post requests
    request.method == "POST" ?  () => {
        request.writeHead(200, { "Content-Type": "text/plain" });
        request.end("");
    } :
    (
        // Direct the client away from gameManager.js
        request.url.toLowerCase().indexOf("gamemanager") != -1 ? () => {} :
        
        // Parse game code syntax (usually looks like @[id]&[options])
        gameCode(request, response)()
        
        // ... then process regular client requests to files on the server
        || fileFetch(request, response)() ? () => true :
        
        () => false
    )
)
() ? () => {} : response.end()

);

/**
 * Parses the GET command to check if it's a game code; returns () => true if the command was executed properly
 * @param request -> The http request
 * @param response -> The http response
 */
let gameCode = (request, response) => (
    /^\/@[0-9\.]+&[a-z]+.*?$/.test(request.url) ? () => {
        gameManager.handleCode(request, response);
        return true;
    } : () => false
);

/**
 * Handles file-fetching from the server; returns () => true if the file fetcher fetched a file
 * @param request -> The http request
 * @param response -> The http response
 */
let fileFetch = (request, response) => (
    // Check to see if the file sought is allowed to be accessed by the client
    /(\/[a-z]*|\.(js|css|txt|json|html?|csv))(\?.*)?$/.test(request.url) ? () => {
        let url = request.url;
        url = url.replace(/\?.*?$/, "");
        
        if (url == "/" || url == "/index")
            deliver("./index.html", response);
        else if (url == "/monitor")
            deliver("./monitor.html", response);
        else if (url == "/bot")
            deliver("./botSubject.html", response);
        
        else {
            // Direct each extension to its appropriate content type
            let type = {
                "html": "text/html",
                "htm": "text/html",
                "js": "text/javascript",
                "css": "text/css",
                "txt": "text/plain",
                "json": "application/json",
                "csv": "text/plain"
            }[url.match(/[a-z]+$/)[0]];
            
            // Change the format of the url into one which is liked by the server
            let filename = url.replace(/^[\/]+/, "./");
            fs.exists(filename, (exists) =>
                (
                    // If the file exists, deliver it to the user
                    exists ? () => {
                        response.writeHead(200, { "Content-Type": type });
                        fs.createReadStream(filename).pipe(response);
                    } : () => {
                    // If not, tell the user they have made an invalid request
                        response.writeHead(404, `file '${request.url}' could not be located.`);
                        response.end();
                    }
                )()
            );
        }
        
        return true;
    } : () => false
);

let deliver = (file, response) => {
    response.writeHead(200, { "Content-Type": "text/html" });
    fs.createReadStream(file).pipe(response);
};

// Initiate the server and go
http.createServer(P).listen(PORT);
