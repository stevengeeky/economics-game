# economics-game
This is a game created in order to analyze how well humans are able to converge towards an optimal global solution to a problem which can only be locally maximized. Specifically, when presented with the iterated choice of choosing either a random or constant value, how well subjects are able to accumulate as much capital as possible over a period of time.

# Rules
Let *K* be the set of all subjects.

*K* is to consist of two subsets, *P* and *Q*, where *P* contains all subjects who are said to be *in*, *Q* contains all subjects who are said to be *out*, and *P* U *Q* = *K*.

Each game consists of *R* rounds, each consisting of *N* iterations. For each iteration, every subject in *P* has the option to switch to *Q*, and those in *Q* have the option to switch to *P*.

Each subject who is said to be *in* after each round is given a pseudo-random value, and those who are *out* are given a constant value. These algorithms are intentionally abstract, and easily modifiable (you can change the default one or make your own in `/scripts/choiceAlgorithms.js`).

If the choice *x* represents the value a subject has received from either switching from *Q* to *P* or remaining in *P*, then let *X* represent the mean of all generated *x* from an iteration.

Let *c* represent the value a subject has received from either switching from *P* to *Q* or remaining in *Q*.

For each iteration, every subject has access to a plot of their previously chosen values, *c* or *x*, as well as a plot of the current and previous *X*s.

**Note**: If all subjects are in *Q* at the end of a given iteration, then *X* = 0 for that iteration.

All subjects additionally have access to what *c* is for each round, and the number of other subjects who have chosen *x*.

Additionally, all subjects are given what their current and cumulative payoff is from *x*.

The goal of the game is to gain as much accumulation as possible.

# Usage
> This setup requires Node.js

Make sure you’ve downloaded algorithm.key from the file tree.

Then `git clone https://github.com/stevengeeky/economics-game.git`.

If you **are not** using cloud9, the server will be started on port 3000 by default. To explicitly change this, just change `"PORT"` in `config.json` to an integer value representing the port you would like the server to run on.

Then, after running app.js with node, open up `[cloud-9-server-name]/monitor` in a new browser tab and drag the `algorithm.key` file into the window (this is a sort of public-private key authentication, where the key is the `algorithm.key` file (be sure to change yours both in `evalCode` in `algorithm.key` and in `evalCode` on the server!)).

Then, you will have access to monitor tools and you can manage a new test.

The first thing we need to do is add subjects, so to do that, we need to allow subjects into the testing area. To do so, click *start accepting subjects* from the monitor panel.

Subjects should now open `[cloud-9-server-name]/index?id=[#]` or simply `[cloud-9-server-name]?id=[#]` and they will be presented with *welcome to the game. please wait just a few moments.* **the PHP id variable is important**, it should be a value between 1 and 8 representing the identity of the current subject.

Also, **to set up a bot**, open `[cloud-9-server-name]/bot?id=[#]` and it will act as a virtual test subject which makes its own decisions. You can change bots' behavior by changing the return value of `botBehavior` in `/js/bot.js`.

If you have eight subjects and two arranged groups, make sure that the monitor page displays **Subjects in each group: 4 | Groups: 2** before beginning the test. If it does not, and you have a number of subjects listed which is greater than 4, hit the Kill Switch on the monitor page. All clients' pages should be reloaded, and the values should be corrected.

Then, to stop more subjects from entering the testing area, just click *stop accepting subjects* from the monitor panel.

From here, click *begin testing* to start testing. All subjects will be immediately presented with the main graph display as well as the switch button (the **algorithm for what value to give subjects** based upon whether they switch or stick to a random or constant option can be found in the file tree at `/scripts/choiceAlgorithms.js`).

Testing can go on for as long or as little as you would like. Just click *end testing* on the monitor panel and the test will end after the current iteration ends. The specific number of iterations per round can be modified in `config.json`.

Once the test has ended, and all clients have submitted their final switch or stay decision, the monitor will be given a link to an `output[timestamp].csv` file which qualitatively describes what decisions each subject made for each iteration during the test and what values and accumulations each received in return.

## Algorithms
In `/scripts/choiceAlgorithms.js`, there are methods for `randomValue` and `constantValue` which are called when a client has selected a random or constant value in the game. These algorithms are supplied with the data from every subject from every round in the game. They are additionally supplied with the id of the client who has requested a random or constant value.

## Todo
* Add concise instructions for subjects to read before the test starts

## Release Notes

1.0.4

* Added round caching in case a host sends back a 503 and all data is otherwise lost

1.0.3

* Added round indexing in cached client information
* Added server-side validation of client decisions

1.0.2

* Added client randomization, explicit and hierarchical round management, a kill switch, config.json, revised subject and bot handling, output to csv, more comprehensive csv info; officially implemented all bits of the randomization algorithm, collected variables for randomization from Jean Paul.

1.0.1

* Added client data-streaming for quick and real-time graph info updates.
* Fixed a bug where if a client pended the server twice before leaving the page, the server would count one additional (inactive) subject.
* Added 'scrolling data' after so many iterations are plotted.
* Revised the server value delivery system as to know what both values the client has to select from before delivering one of them.
* Added basic client info to the monitor page.
* Revised the monitor control panel to sync more effectively after an action has taken place.
* Added more data to output.json.

1.0.0

Initial release.
