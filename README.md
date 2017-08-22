# economics-game
This is a game created in order to analyze how well humans are able to converge towards an optimal global solution to a problem which can only be locally maximized. Specifically, when presented with the iterated choice of choosing either a random or constant value, how well subjects are able to accumulate as much capital as possible over a period of time.

# Rules
This is a game containing a bunch of subjects, and a bunch of decisions to be made on an individual basis. The goal of any one subject is to, by the end of the game, possess a favorable (or at least positive) amount of capital.

In this game, there are two groups: the *in* group and *out* group. The *out* group will always receive a constant amount of capital in each round, whereas the *in* group will receive an amount that follows a randomization algorithm, whose entropy is determined by the number of subjects who are currently *in*.

A game has an indefinite number of rounds, until the test monitor decides that it is time to end the test. Within each round, there are a certain number of iterations in which subjects are prompted to either stay in their current group (which defaults to *out*) or switch to the opposite group.

Throughout the entirety of each round, subjects are presented with a graph which lets them visualize the history of decisions they have made, the group average of capital made from all subjects who are *in*, a line representing the constant value they may choose to receive at any time, and, if the monitor chooses to allow it, a line representing the previous behavior of the 'random' value.

The goal of any one subject is to end up with as much capital as possible.
<!-- 
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

The goal of the game is to gain as much accumulation as possible. -->

# Usage
> Make sure you have node.js and npm installed

> Make sure you’ve downloaded algorithm.key from the file tree.

Then `git clone https://github.com/stevengeeky/economics-game.git`.

All of the options regarding how your test will be conducted are in `config.json`, it might look like this:

## Configure All the Things

```
{
    "PORT": "8888",
    "number_of_iterations": 10,
    "people_per_group": 2,
    "delete_previous_collective_data_logging_upon_data_write": true,
    "output_format": "csv",
    "x_visible_to_out_subjects": false,
    "constant_groups": [],
    "killTimeout": "null",
    "max_sync_attempts": 5
}
```

**"PORT"** => What port to run on, this supports value "process.env.PORT" if your are running on a cloud environment.

**"number_of_iterations"** => How many iterations are in each round

**"people_per_group"** => Subjects who are the test are aggregated into smaller groupings of the size determined by this value. Within each of these smaller groupings there are the two aforementioned *in* and *out* groups, and each subject within each grouping defaults to *out* by default. After each round, all of these groupings are randomized. In the output CSV file, however, there remains a global ID to identify each subject as they carry over between iterations, and between rounds.

**"delete_previous_collective_data_logging_upon_data_write"** => Whether to delete previous round data before producing new data for a new test.

**"output_format"** => Supported values: "csv" and "json"

**"x_visible_to_out_subjects"** => If subjects are *out*, this option determines whether or not they can still observe the pattern of their random choice over time.

**"constant_groups"** => An array of groupings to not randomize across rounds. If this value were set to [1], for example, it means that subjects within the first grouping would remain in the first grouping throughout the entirety of the game.

**"killTimeout"** => Might never be used in production, but for debugging this determines how long to wait until killing off a stale subject.

**"max_sync_attempts"** => For debugging, this determines how many times the server should try and recommunicate with a subject until that subject is considered stale.

## Test Setup for the Test Monitor

Serve the testing environment: do `./start.sh` at the root of your cloned repo.

The test monitor oversees when each test starts and ends. In order to claim to be a test monitor, go to `/monitor` (in your browser) and drag `algorithm.key` into the page. This is how authentication takes place. If authorized, you should now see a list of monitor controls.

To let subjects join the test, click 'Start Accepting Subjects.' After a sufficient number of subjects have joined, you may start the test by clicking 'Begin Testing' or run through a practice round first. If a subject joins more than once throughout the course of subject acceptance, your subject count may be off. If this occurs, first make sure you are still accepting subjects. Then, use the `kill switch` at the bottom of the monitor page to reload all legitimate subjects' pages and reset all server monitor variables.

## Test Setup for Subjects

For subjects to be able to join the test, the test monitor must first allow subjects to join the test. Then, each subject should go to `/subject?id=[their_subject_number]`, so subject 1 should go to `/subject?id=1`, subject 2 goes to `/subject?id=2` and so on. These ids will additionally be the same as the global ids in the resulting output csv file after the test has ended.

# How Subjects are Put Into Groupings

Say that I have a list of 9 subjects, such that I can arrange them in the following way:

`[1, 2, 3, 4, 5, 6, 7, 8, 9]`

If I set the number of subjects per group(ing) to be 3, then I could subsequently organize those subjects like this:

`[[1, 2, 3], [4, 5, 6], [7, 8, 9]]`

So if I refer to grouping '1', I am talking about `[1, 2, 3]`. If I refer to grouping '2', I am talking about `[4, 5, 6]`. Now, say a round passes, but in my `config.json` I have `"constant_groups": [1]`. What will happen? Well, all groupings except 1 will be randomized, i.e. we might end up with

`[[1, 2, 3], [9, 6, 8], [4, 5, 7]]`

But grouping '1' will always be `[1, 2, 3]`. Groupings '2' and '3' will be randomized non-permutably. Within each particular grouping, there are also 'groups' *in* and *out*. So within grouping '1', if subject 1 were *in*, but 2 and 3 were *out*, subject 1 would observe their own value as identitical to the group average (since they are the only subject within the grouping `[1, 2, 3]` who is *in*). `[9, 6, 8]` would possess separate *in* and *out* groups, and the same applies to `[4, 5, 7]`. I.e. within each grouping, there are exactly two groups.

<!-- If you **are not** using cloud9, the server will be started on port 3000 by default. To explicitly change this, just change `"PORT"` in `config.json` to an integer value representing the port you would like the server to run on. -->

<!-- Then, after running app.js with node, open up `[cloud-9-server-name]/monitor` in a new browser tab and drag the `algorithm.key` file into the window (this is a sort of public-private key authentication, where the key is the `algorithm.key` file (be sure to change yours both in `evalCode` in `algorithm.key` and in `evalCode` on the server!)). -->

# What if Something Goes Wrong?

If your served test stops prematurely either due to a bug or an external hosting provider, all testing data is cached after each round in the data directory, so you can still recover most of testing data. If you discover a bug of any sort or simply encounter confusion or usage problems, feel free to open up an issue.

Further, if you would like to improve any part of this application in any way (such as exchanging out endless server pings with websockets), do feel free to fork and pull request your updates.

<!-- Then, you will have access to monitor tools and you can manage a new test.

The first thing we need to do is add subjects, so to do that, we need to allow subjects into the testing area. To do so, click *start accepting subjects* from the monitor panel.

Subjects should now open `[cloud-9-server-name]/index?id=[#]` or simply `[cloud-9-server-name]?id=[#]` and they will be presented with *welcome to the game. please wait just a few moments.* **the PHP id variable is important**, it should be a value between 1 and 8 representing the identity of the current subject.

Also, **to set up a bot**, open `[cloud-9-server-name]/bot?id=[#]` and it will act as a virtual test subject which makes its own decisions. You can change bots' behavior by changing the return value of `botBehavior` in `/js/bot.js`.

If you have eight subjects and two arranged groups, make sure that the monitor page displays **Subjects in each group: 4 | Groups: 2** before beginning the test. If it does not, and you have a number of subjects listed which is greater than 4, hit the Kill Switch on the monitor page. All clients' pages should be reloaded, and the values should be corrected.

Then, to stop more subjects from entering the testing area, just click *stop accepting subjects* from the monitor panel.

From here, click *begin testing* to start testing. All subjects will be immediately presented with the main graph display as well as the switch button (the **algorithm for what value to give subjects** based upon whether they switch or stick to a random or constant option can be found in the file tree at `/scripts/choiceAlgorithms.js`).

Testing can go on for as long or as little as you would like. Just click *end testing* on the monitor panel and the test will end after the current iteration ends. The specific number of iterations per round can be modified in `config.json`.

Once the test has ended, and all clients have submitted their final switch or stay decision, the monitor will be given a link to an `output[timestamp].csv` file which qualitatively describes what decisions each subject made for each iteration during the test and what values and accumulations each received in return. -->

# Algorithms
In `/scripts/choiceAlgorithms.js`, there are methods for `randomValue` and `constantValue` which are called when a client has selected a random or constant value in the game. These algorithms are supplied with the data from every subject from every round in the game. They are additionally supplied with the id of the client who has requested a random or constant value.

In other words, if you would like to modify how constant or random values are distributed to each client in each grouping in each group, `/scripts/choiceAlgorithms.js` is the place to do it.

## Release Notes

1.0.4.4

* Made readme and general setup instructions a little bit more clearer

1.0.4.3

* Added more comments
* Added ability for subjects to visualize x even if they are currently out (configurable in config.json)
* Changed randomization algorithm slightly

1.0.4.2

* Revised global ids to display as the initially set url ids of each client
* Sorted end csv by <i>g<sub>id</sub></i>

1.0.4.1

* Revised the output.csv file to organize by group, instead of by playerID
* Added logging for the server's globally unique ID for each client to track clients' decision progress even after each test is over

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
