/**
 * @name choice algorithms
 * @author steven o'riley
 * @desc contains the methods called when a user or bot selects 'constant value' or 'random value'
 */

'use strict';

// Included the stats file just in case you need it
// you == anyone tweaking the algorithm file
let stats = require("./stats.js");

// The constant value to grant the user
let c = 80;

/**
 * Variables to use with the 'random' generation process
 * Reminder:        x_t = Theta_t + epsilon_t, where epsilon_t ~ N(0, Gamma_x^-1)
 *           and    Theta_tp1 = alpha + rho(Theta_t - alpha) + sigma_Theta * omega_tp1
 */
let Theta_0 = () => 100,
    Gamma_xm1 = 1 / .001,
    epsilon = () => stats.normal_distribution() * Math.sqrt(Gamma_xm1),
    alpha = () => 100,
    rho = () => .99,
    sigma = () => 6,
    omega = (t) => stats.normal_distribution();

// Calculate next theta
let Theta_tp1 = (group) => {
    Theta_list[group] = Theta_list[group] || [];
    let t = Theta_list[group].length - 1;
    if (t == -1)
        return Theta_0();
    
    let a = alpha(),
        T_t = Theta_list[group][t],
        p = rho(),
        o = sigma(),
        w = omega();
    
    return a + p * (T_t - a) + o * w;
};

// Calculate next x
let x_t = (clientid, group) => {
    let t = x_list[clientid].length,
        e = epsilon();
    
    Theta_list[group] = Theta_list[group] || [];
    return t >= Theta_list[group].length ? null : Theta_list[group][t] + e;
};

let Theta_list = {}, x_list = {};

/**
 * Called when the round changes
 */
let roundChanged = function() {
    x_list = {};
    Theta_list = {};
}

/**
 * Generates a sudo-random value for the client
 */
let randomValue = function(data, mod, clientid, group) {
    let iter = Math.max(data['iterations'] - 1, 0);
    
    x_list[clientid] = x_list[clientid] || [];
    Theta_list[group] = Theta_list[group] || [];
    
    while (iter + 2 > Theta_list[group].length)
        Theta_list[group].push(Theta_tp1(group));
    while (iter + 1 > x_list[clientid].length)
        x_list[clientid].push(x_t(clientid, group));
    
    return x_list[clientid][iter];
};

// Generate a constant value for the client
let constantValue = function(data, id) {
    return c;
};

let getTheta = (t, group) => {
    Theta_list[group] = Theta_list[group] || [];
    if (t >= Theta_list[group].length)
        Theta_list[group].push(Theta_tp1(group));
    return Theta_list[group][t];
};

// nodejs module exports
module.exports = () => ({
    "random": randomValue,
    "constant": constantValue,
    "getTheta": getTheta,
    "roundChanged": roundChanged
});