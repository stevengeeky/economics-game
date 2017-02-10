/**
 * @name get options
 * @author steven o'riley
 * @desc returns the options for the game as specified in config.json
 */

'use strict';

let fs = require('fs');
let json = fs.readFileSync("./config.json");

module.exports = JSON.parse(json);