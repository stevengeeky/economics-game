'use strict';

let stats = {
    sum: (S) => S.length == 0 ? 0 : S.pop() + sum(S),
    mu: (S) => sum(S) / S.length,
    foldr: (S, func, curr) => S.length == 0 ? curr : (curr || []).push(func(S.pop())),
    sigma: (S) => {
        var avg = mu(S);
        return Math.sqrt( mu( foldr(S, (v) => Math.pow(v - avg, 2)) ) );
    },
    variance: (S) => Math.pow(sigma(S), 2),
    N: (u, Y) => u instanceof Array ? N(mu(u), Math.pow(sigma(u), 2)) :
            (x) => 1 / Math.sqrt(2 * Y * Math.PI) * Math.exp(-Math.pow(x - u, 2) / 2 / Y)
};

exports = () => stats;