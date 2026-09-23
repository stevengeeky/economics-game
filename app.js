/**
 * @name main server file
 * @desc the main server file; serves the pages and bridges the websocket to the game
 *
 * Every subject and monitor holds one websocket open at /ws and speaks JSON:
 *
 *   subject -> server   { "type": "join", "id": <page id>, "realid": <url id> }
 *                       { "type": "submit", "choice": "random" | "constant" }
 *                       { "type": "graph_info" }
 *                       { "type": "leave" }
 *   server -> subject   { "message": "clients_not_accepted" | "begin" | "graph_info" | "round_passed"
 *                                    | "restart" | "end" | "finalize_end" | "kill", ... }
 *
 *   monitor -> server   { "type": "request", "id": <monitor id>, "reqid": n }
 *                       { "type": "respond", "id": <monitor id>, "m": <answer from algorithm.key>, "quest": <command>, "reqid": n }
 *                       { "type": "client_info" }
 *   server -> monitor   { "reply": n, "text": "..." }
 *                       { "message": "client_info", "number_of_groups", "number_of_subjects", "iteration", "round" }
 */

'use strict';

// For server request/response handling
let http = require('http');

// For piping pages to the client
let fs = require('fs');
let path = require('path');

// For talking to subjects and monitors
let { WebSocketServer } = require('ws');

// For running the game
let createGame = require('./scripts/gameManager');

// Pages
let pages = {
    "/": "index.html",
    "/index": "index.html",
    "/subject": "index.html",
    "/monitor": "monitor.html",
    "/bot": "botSubject.html"
};

// Direct each extension to its appropriate content type
let types = {
    "html": "text/html",
    "htm": "text/html",
    "js": "text/javascript",
    "css": "text/css",
    "txt": "text/plain",
    "json": "application/json",
    "csv": "text/plain"
};

/**
 * Makes the http + websocket server for one game
 * @param options -> the parsed config.json (see scripts/getOptions.js)
 * @returns the http server; `.game` is the game behind it
 */
let createServer = (options) => {
    let game = createGame(options);
    let dataDir = options.data_dir || path.join(__dirname, 'data');

    /**
     * Main server feed, handles all page/file requests
     */
    let server = http.createServer((request, response) => {
        if (request.method != "GET" && request.method != "HEAD") {
            response.writeHead(405);
            response.end();
            return;
        }

        let url = request.url.replace(/\?.*$/, "");

        if (pages[url])
            return deliver(path.join(__dirname, pages[url]), "text/html", response);

        // The only files the client may fetch: js/*, css/*, and the output files in data/*
        let m = url.match(/^\/(js|css|data)\/([a-zA-Z0-9_\-.]+)\.([a-z]+)$/);
        if (!m || !types[m[3]]) {
            response.writeHead(404, { "Content-Type": "text/plain" });
            response.end(`file '${request.url}' could not be located.`);
            return;
        }

        let filename = m[1] == "data" ? path.join(dataDir, `${m[2]}.${m[3]}`) : path.join(__dirname, m[1], `${m[2]}.${m[3]}`);
        deliver(filename, types[m[3]], response);
    });

    /**
     * The websocket feed, handles all game messages
     */
    let wss = new WebSocketServer({ "server": server, "path": "/ws" });

    wss.on('connection', (socket) => {
        // What this socket turned out to be, and who
        let role = null, id = null;

        let send = (message) => {
            if (socket.readyState == socket.OPEN)
                socket.send(JSON.stringify(message));
        };

        socket.on('message', (raw) => {
            let msg;
            try {
                msg = JSON.parse(raw);
            }
            catch (ex) {
                return;
            }
            if (!msg || typeof msg != "object")
                return;

            /* Subject */

            // Put the subject somewhere on the server
            if (msg.type == "join") {
                role = "subject";
                id = msg.id + "";
                if (!game.join(id, +msg.realid || 0, send))
                    send({ "message": "clients_not_accepted" });
            }
            // subject submits a decision
            else if (msg.type == "submit" && role == "subject")
                game.submit(id, msg.choice);
            // For updating the graph as other players choose
            else if (msg.type == "graph_info" && role == "subject") {
                let info = game.graphInfo(id);
                if (info)
                    send(info);
            }
            // A subject has left
            else if (msg.type == "leave" && role == "subject")
                game.leave(id);

            /* Monitor */

            // If the potential monitor requests an authentication value, give them one
            else if (msg.type == "request") {
                role = "monitor";
                send({ "reply": msg.reqid, "text": game.requestCode(msg.id + "") });
            }
            // Authenticate the potential monitor and then evaluate their query
            else if (msg.type == "respond") {
                role = "monitor";
                game.command(msg.id + "", msg.m, msg.quest, (text) => send({ "reply": msg.reqid, "text": text }));
            }
            // The monitor wants to know about the subjects, now and whenever that changes
            else if (msg.type == "client_info") {
                role = "monitor";
                game.watch(send);
            }
        });

        socket.on('close', () => {
            if (role == "subject")
                game.disconnect(id);
            else if (role == "monitor")
                game.unwatch(send);
        });
        socket.on('error', () => {});
    });

    server.game = game;
    return server;
};

/**
 * Delivers a file to the user, or a 404
 */
let deliver = (file, type, response) => {
    fs.stat(file, (err, stat) => {
        if (err || !stat.isFile()) {
            response.writeHead(404, { "Content-Type": "text/plain" });
            response.end(`file '${path.basename(file)}' could not be located.`);
            return;
        }
        response.writeHead(200, { "Content-Type": type });
        fs.createReadStream(file).pipe(response);
    });
};

module.exports = { createServer };

// Initiate the server and go
if (require.main === module) {
    // For user-option handling
    let options = require('./scripts/getOptions');
    let PORT = options.PORT == "process.env.PORT" ? process.env.PORT || 3000 : (options.PORT || process.env.PORT || 3000);

    let server = createServer(options);
    server.listen(PORT, () => {
        console.log(`economics-game is running on http://localhost:${server.address().port}`);
        console.log(`subjects: /subject?id=1 ...  bots: /bot?id=1 ...  monitor: /monitor`);
    });
}
