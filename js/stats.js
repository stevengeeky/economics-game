'use strict';

// basic statistical functions

let stats = {
    // sum of a list
    sum: (S) => S.length == 0 ? 0 : S.pop() + sum(S),
    
    // average of a list
    mu: (S) => sum(S) / S.length,
    
    // same as foldr from haskell
    foldr: (S, func, curr) => S.length == 0 ? curr : (curr || []).push(func(S.pop())),
    
    // stddev from a list
    sigma: (S) => {
        var avg = mu(S);
        return Math.sqrt( mu( foldr(S, (v) => Math.pow(v - avg, 2)) ) );
    },
    
    // variance from a list
    variance: (S) => Math.pow(sigma(S), 2),
    
    // normal distribution function from a given average and variance
    N: (u, Y) => u instanceof Array ? N(mu(u), Math.pow(sigma(u), 2)) :
            (x) => 1 / Math.sqrt(2 * Y * Math.PI) * Math.exp(-Math.pow(x - u, 2) / 2 / Y)
};

exports = () => stats;