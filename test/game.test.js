/**
 * @name game test
 * @desc starts the server on a free port, plays a whole test with simulated subjects over the socket
 *       (no browser, no humans), and checks the output csv and the payoff rules from the README:
 *         - subjects who are out get the constant value Q every period
 *         - subjects who are in get the random value x
 *         - x is only shown to subjects who are out when config.json says so
 *
 * Run with `npm test`.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const { createServer } = require('../app');

const ROOT = path.join(__dirname, '..');
const baseConfig = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));

// The constant value in scripts/choiceAlgorithms.js
const Q = 80;

// The monitor's half of the key mechanism, run exactly as the browser runs it
const access_func = {};
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'algorithm.key'), 'utf8'), { access_func });

/* Helpers */

// Starts the server on a free port
const listen = (options) => new Promise((resolve) => {
    const server = createServer(options);
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
});

// One socket to the server, with a way to wait for a message
class Peer {
    static open(port) {
        return new Promise((resolve, reject) => {
            const peer = new Peer(new WebSocket(`ws://127.0.0.1:${port}/ws`));
            peer.socket.addEventListener('open', () => resolve(peer));
            peer.socket.addEventListener('error', (e) => reject(e.error || new Error('socket error')));
        });
    }

    constructor(socket) {
        this.socket = socket;
        this.all = [];          // every message received
        this.unread = [];       // messages nobody has waited for yet
        this.waiters = [];
        socket.addEventListener('message', (e) => {
            const message = JSON.parse(e.data);
            this.all.push(message);
            const i = this.waiters.findIndex((w) => w.predicate(message));
            if (i != -1)
                this.waiters.splice(i, 1)[0].resolve(message);
            else
                this.unread.push(message);
        });
    }

    send(message) {
        this.socket.send(JSON.stringify(message));
    }

    // Resolves with the first (unread or future) message matching the predicate
    wait(predicate, ms = 5000) {
        const i = this.unread.findIndex(predicate);
        if (i != -1)
            return Promise.resolve(this.unread.splice(i, 1)[0]);
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`timed out waiting for a message; last ones: ${JSON.stringify(this.all.slice(-3))}`)), ms);
            this.waiters.push({ predicate, resolve: (m) => { clearTimeout(timer); resolve(m); } });
        });
    }

    close() {
        this.socket.close();
    }
}

// A monitor: asks questions the way js/monitor.js does (request -> respond, authenticated with algorithm.key)
const openMonitor = async (port) => {
    const monitor = await Peer.open(port);
    monitor.gid = Math.random();
    let nextReqId = 1;

    monitor.ask = (message) => {
        const reqid = nextReqId++;
        monitor.send(Object.assign({ reqid }, message));
        return monitor.wait((m) => m.reply == reqid, 10000).then((m) => m.text);
    };
    monitor.command = async (quest, evalCode = access_func.evalCode) => {
        const code = await monitor.ask({ type: 'request', id: monitor.gid });
        return monitor.ask({ type: 'respond', id: monitor.gid, m: evalCode(+code), quest });
    };
    monitor.clientInfo = (predicate) => monitor.wait((m) => m.message == 'client_info' && predicate(m));
    return monitor;
};

// A subject: joins with a url id, and decides according to a policy(globalId, round, period)
const openSubject = async (port, realid, policy) => {
    const subject = await Peer.open(port);
    subject.gid = Math.random();
    subject.realid = realid;
    subject.globalId = realid;
    subject.policy = policy;
    subject.send({ type: 'join', id: subject.gid, realid });
    return subject;
};

// Every subject decides for the given period of the given round
const submitAll = (subjects, round, period) => {
    for (const s of subjects) {
        const choice = s.policy(s.globalId, round, period);
        s.choices.push(choice);
        s.send({ type: 'submit', choice });
    }
};

const isRoundPassed = (period) => (m) => m.message == 'round_passed' && m.iteration == period;

// Parses the output csv into { 'Round 1': [row, ...], ... }, checking its shape as it goes
const parseCsv = (text) => {
    const header = 'GlobalID,PlayerID,GroupID,Choice,Payoff,Period,Round,Theta,X,Practice,x,Q';
    const lines = text.split('\n');
    assert.equal(lines[lines.length - 1], '', 'csv ends with a newline');
    lines.pop();

    const rounds = {};
    let current = null;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const r = line.match(/^Round (\d+)$/);
        if (r) {
            current = line;
            rounds[current] = [];
            assert.equal(lines[++i], header, `column header follows '${line}'`);
            continue;
        }
        assert.ok(current, `row before any round heading: '${line}'`);
        const cols = line.split(',');
        assert.equal(cols.length, 12, `12 columns in '${line}'`);
        const row = {};
        header.split(',').forEach((name, j) => { row[name] = +cols[j]; assert.ok(Number.isFinite(row[name]), `${name} is a number in '${line}'`); });
        assert.equal(row.Round, +r0(current), 'Round column matches the heading');
        rounds[current].push(row);
    }
    return rounds;
};
const r0 = (s) => s.match(/\d+/)[0];

/**
 * Plays one whole test: N subjects, one full round (number_of_iterations periods), then two periods of a second
 * round, then the monitor ends the test, and the third period of round 2 finishes it.
 */
const play = async ({ options, N, policy, practice }) => {
    const { server, port } = await listen(options);
    const subjects = [];
    let monitor;

    try {
        monitor = await openMonitor(port);

        // the key mechanism: right key -> in, wrong key -> '-'
        assert.equal(await monitor.command('test'), 'success');
        assert.equal(await monitor.command('test', (code) => 'not the key'), '-');
        assert.equal(await monitor.command('checkStatus'), '');

        // nobody is let in before the monitor says so
        const early = await openSubject(port, 99, policy);
        assert.equal((await early.wait((m) => m.message == 'clients_not_accepted')).message, 'clients_not_accepted');
        early.close();

        assert.equal(await monitor.command('startAccepting'), '+');
        if (practice)
            assert.equal(await monitor.command('startPractice'), '+');
        assert.equal(await monitor.command('checkStatus'), practice ? 'accepting practicing' : 'accepting');

        monitor.send({ type: 'client_info' });
        await monitor.clientInfo((m) => m.number_of_subjects == 0);

        for (let i = 1; i <= N; i++)
            subjects.push(await openSubject(port, i, policy));
        await monitor.clientInfo((m) => m.number_of_subjects == N);

        // a subject whose line drops is dropped after killTimeout
        const flaky = await openSubject(port, N + 1, policy);
        await monitor.clientInfo((m) => m.number_of_subjects == N + 1);
        flaky.close();
        const info = await monitor.clientInfo((m) => m.number_of_subjects == N);
        assert.equal(info.number_of_groups, Math.ceil(N / options.people_per_group));

        // ...and nobody gets in after acceptance stops
        assert.equal(await monitor.command('stopAccepting'), '+');
        const late = await openSubject(port, N + 2, policy);
        await late.wait((m) => m.message == 'clients_not_accepted');
        late.close();

        /* Round 1 */
        assert.equal(await monitor.command('startTest'), '+');
        assert.equal(await monitor.command('checkStatus'), practice ? 'testing practicing' : 'testing');

        for (const s of subjects) {
            const begin = await s.wait((m) => m.message == 'begin');
            // everybody starts in, and is offered x (random) and Q (constant)
            assert.equal(begin.out, 0);
            assert.equal(begin.in, begin.subjects);
            assert.equal(begin.const, Q);
            assert.equal(typeof begin.rand, 'number');
            assert.equal(begin.value, begin.rand);
            assert.equal(begin.x_visible_to_out_subjects, !!options.x_visible_to_out_subjects);
            s.start = begin;
            s.passed = [];
            s.choices = [];
        }

        const periods = options.number_of_iterations;
        for (let period = 1; period <= periods; period++) {
            submitAll(subjects, 1, period);
            for (const s of subjects)
                s.passed.push(await s.wait(isRoundPassed(period)));
        }
        checkRound(subjects, options);

        // one more decision ends the round (it is not written to the csv, as before)
        submitAll(subjects, 1, periods + 1);
        const newIds = [];
        for (const s of subjects) {
            const restart = await s.wait((m) => m.message == 'restart');
            assert.equal(restart.round, 2);
            assert.equal(typeof restart.rand, 'number');
            newIds.push(restart.new_realid);
            s.realid = restart.new_realid;
            s.start = restart;
            s.passed = [];
            s.choices = [];
        }
        // the subjects were shuffled, not lost
        assert.deepEqual(newIds.slice().sort((a, b) => a - b), subjects.map((s, i) => i + 1));
        await monitor.clientInfo((m) => m.round == 2 && m.iteration == 1);

        /* Round 2 */
        for (let period = 1; period <= 2; period++) {
            submitAll(subjects, 2, period);
            for (const s of subjects)
                s.passed.push(await s.wait(isRoundPassed(period)));
        }

        // the monitor ends the test; the reply (the output file) comes when the running period ends
        const ending = monitor.command('endTest');
        for (const s of subjects)
            await s.wait((m) => m.message == 'end');
        submitAll(subjects, 2, 3);
        for (const s of subjects)
            s.passed.push(await s.wait((m) => m.message == 'finalize_end'));
        const output = await ending;
        checkRound(subjects, options);

        assert.match(output, /^\/data\/output\d+\.csv$/);
        assert.equal(await monitor.command('checkStatus'), practice ? 'practicing' : '');

        /* The output file */
        const csv = fs.readFileSync(path.join(options.data_dir, path.basename(output)), 'utf8');
        const rounds = parseCsv(csv);
        assert.deepEqual(Object.keys(rounds), ['Round 1', 'Round 2']);

        for (const round of [1, 2]) {
            const rows = rounds[`Round ${round}`];
            assert.equal(rows.length, N * periods, `${N} subjects x ${periods} periods in round ${round}`);

            for (let id = 1; id <= N; id++) {
                const mine = rows.filter((r) => r.GlobalID == id);
                assert.deepEqual(mine.map((r) => r.Period), [1, 2, 3], `one row per period for subject ${id} in round ${round}`);
                for (const row of mine) {
                    const choice = policy(id, round, row.Period);
                    assert.equal(row.Choice, choice == 'random' ? 0 : 1, `Choice column for subject ${id}, round ${round}, period ${row.Period}`);
                    assert.equal(row.Practice, practice ? 1 : 0);
                    assert.equal(row.Q, Q, 'Q is the constant value');
                    assert.ok(row.GroupID >= 1 && row.GroupID <= Math.ceil(N / options.people_per_group));
                    assert.ok(row.PlayerID >= 1 && row.PlayerID <= options.people_per_group);
                    // out -> the constant payoff; in -> the random payoff x
                    if (row.Choice == 1)
                        assert.equal(row.Payoff, Q, 'out subjects receive the constant value');
                    else {
                        // (as before: in the period the monitor ends the test in, Payoff is the value received,
                        // i.e. the x offered the period before; in every other period it is the x offered now)
                        const endedHere = round == 2 && row.Period == periods;
                        const x = endedHere ? mine.find((r) => r.Period == periods - 1).x : row.x;
                        assert.equal(row.Payoff, x, 'in subjects receive the random value');
                        assert.notEqual(row.Payoff, Q);
                    }
                }
            }
            // rows are sorted by global id
            assert.deepEqual(rows.map((r) => r.GlobalID), rows.map((r) => r.GlobalID).sort((a, b) => a - b));
        }

        // the round cache written when round 1 ended is there too
        const cached = fs.readdirSync(options.data_dir).filter((f) => /^output\d+\.tmp\.csv$/.test(f));
        assert.equal(cached.length, 1);
        assert.deepEqual(Object.keys(parseCsv(fs.readFileSync(path.join(options.data_dir, cached[0]), 'utf8'))), ['Round 1']);

        /* The kill switch */
        assert.equal(await monitor.command('killEverything'), '+');
        for (const s of subjects)
            await s.wait((m) => m.message == 'kill');
        await monitor.clientInfo((m) => m.number_of_subjects == 0 && m.round == 0);
    }
    finally {
        for (const s of subjects)
            s.close();
        if (monitor)
            monitor.close();
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
    }
};

// Checks what the subjects were told during a round against the payoff rules
const checkRound = (subjects, options) => {
    for (const s of subjects) {
        const passed = s.passed.filter((m) => m.message == 'round_passed');
        let accumulation = 0, prev = s.start;
        passed.forEach((m, i) => {
            assert.equal(m.choice, s.choices[i], 'the subject is told the choice it made');
            assert.equal(m.const, Q);

            // out -> Q; in -> the x that was offered for this period (unknowable here if it was hidden)
            const payoff = m.choice == 'constant' ? Q : 'rand' in prev ? prev.rand : null;
            if (payoff === null)
                accumulation = m.accumulation;
            else {
                accumulation += payoff;
                assert.ok(Math.abs(m.accumulation - accumulation) < 1e-9, `accumulation after period ${i + 1}: ${m.accumulation} vs ${accumulation}`);
            }

            // what x looks like to a subject who is out
            if (m.choice == 'constant') {
                if (options.x_visible_to_out_subjects)
                    assert.equal(typeof m.rand, 'number', 'x is visible to out subjects');
                else
                    assert.equal('rand' in m, false, 'x is hidden from out subjects');
                assert.equal(m.value, Q);
            }
            else {
                assert.equal(typeof m.rand, 'number');
                assert.equal(m.value, m.rand);
            }
            prev = m;
        });
    }
};

/* Tests */

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'economics-game-'));

// subject 1 stays in, subject 2 stays out, everyone else alternates
const policy = (id, round, period) => id == 1 ? 'random' : id == 2 ? 'constant' : ((id + round + period) % 2 ? 'random' : 'constant');

test('a whole test over sockets, x hidden from out subjects', async () => {
    const data_dir = tmp();
    await play({
        options: Object.assign({}, baseConfig, { number_of_iterations: 3, people_per_group: 2, killTimeout: 50, x_visible_to_out_subjects: false, data_dir }),
        N: 4,
        policy,
        practice: false
    });
    fs.rmSync(data_dir, { recursive: true });
});

test('a practice test with an uneven last grouping, x visible to out subjects', async () => {
    const data_dir = tmp();
    await play({
        options: Object.assign({}, baseConfig, { number_of_iterations: 3, people_per_group: 2, killTimeout: 50, x_visible_to_out_subjects: true, data_dir }),
        N: 3,
        policy,
        practice: true
    });
    fs.rmSync(data_dir, { recursive: true });
});
