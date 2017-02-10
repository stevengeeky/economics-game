/**
 * @name stats
 * @author steven o'riley
 * @desc contains a bunch of statistics functions which might be useful
 */

'use strict';

// To be exported
let stats = {
    /**
     * Returns the summation of a set S
     * @param S -> the set to sum
     */
    sum: (S) => {
        let s = 0;
        for (let v of S)
            s += v;
        return s;
    },
    
    /**
     * Returns the mean of a set S
     * @param S -> the set to take the average of
     */
    mu: (S) => stats.sum(S) / S.length,
    
    /**
     * Small implementation of foldr like in haskell;
     * acts as an equivalent to map in haskell, C++, Python, and Java
     * @param S -> the set to apply an item-based operation on
     * @param func -> the operation to perform
     */
    foldr: (S, func, curr) => {
        let s = [];
        for (let v of S)
            s.push(func(v));
        return s;
    },
    
    /**
     * Returns the standard deviation of a set S
     * @param S -> the set to take the stddev of
     */
    variance: (S) => {
        var avg = stats.mu(S);
        return stats.mu( stats.foldr(S, (v) => Math.pow(v - avg, 2)) );
    },
    
    /**
     * Returns the variance of a set S
     * @param S -> the set to take the variance of
     */
    sigma: (S) => Math.sqrt(stats.variance(S)),
    
    /**
     * Returns a lambda function for the normal distribution curve with parameters u, Y
     * @param u -> mu
     * @param Y -> gamma
     */
    N: (u, Y) => u instanceof Array ? stats.N(stats.mu(u), stats.variance(u)) :
            (x) => 1 / Math.sqrt(2 * Y * Math.PI) * Math.exp(-Math.pow(x - u, 2) / 2 / Y),
    
    /**
     * Returns a normal distribution curve
     */
    normal_distribution: () => {
        let u = 1 - Math.random();
        let v = 1 - Math.random();
        return Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI *  v );
    },
    
    /**
     * Returns the max value of a set
     */
    max: (S) => {
        if (S.length == 0)
            return null;
        let m = S[0];
        for (let i = 1; i < S.length; i++)
            if (S[i] > m)
                m = S[i];
        return m;
    }
};

module.exports = stats;