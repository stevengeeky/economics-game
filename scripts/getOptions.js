/**
 * @name get options
 * @desc returns the options for the game as specified in config.json
 *       (next to app.js, or the file named by the ECONOMICS_GAME_CONFIG environment variable)
 */

'use strict';

let fs = require('fs');
let path = require('path');

let file = process.env.ECONOMICS_GAME_CONFIG || path.join(__dirname, '..', 'config.json');
let json = fs.readFileSync(file);

module.exports = JSON.parse(json);
