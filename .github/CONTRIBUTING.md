# Contributing to node-red-contrib-iiot-opcua

As in Node-RED we have some guidelines for the OPC UA IIoT contribution package.
We welcome contributions, but request you follow these guidelines.

- [Coding rules](#coding-rules)
- [Raising issues](#raising-issues)
- [Feature requests](#feature-requests)
- [Pull-Requests](#pull-requests)

## How to start

1. install node-red global without the IIoT OPC UA package
2. run the shell script:  ./clean.sh
3. run command: npm run dev-link
4. start node-red and see the IIoT OPC UA nodes for testing
5. start your test and develop life cycle
6. Create a new version via 'npm run release & npm run rewrite-changelog'

You can unlink via 'npm run dev-unlink' and test via 'npm test'.
Check the coverage state before and after your development via 'npm run coverage'!

## Coding rules

1. Code for one another, and use tools to perform mechanical optimizations.
2. Keep it simple; compactness != succinctness.
3. Just because you can doesn’t mean you should.
4. Utilize familiar paradigms and patterns.
5. Consistency is king.
6. Lay good foundations. Be mindful of evolutionary complexity.
7. Write tests and check the coverage of your code.

## Raising issues

Please raise any bug reports on the relevant project's issue tracker.
Be sure to search the list to see if your issue has already been raised.

A good bug report is one that make it easy for us to understand what you were
trying to do and what went wrong.

Provide as much context as possible so we can try to recreate the issue.
If possible, include the relevant part of your flow. To do this, select the
relevant nodes, press Ctrl-E and copy the flow data from the Export dialog.

At a minimum, please include:

- Version of node.js? (should be >= 16)
- Version of Node-RED? (should be >= 3)
- Version of node-red-contrib-iiot-opcua? (should be >= 4)

- What is your platform? (Linux, macOS, ...)
- What does `DEBUG=opcuaIIoT:* node-red -v` say? (log files are welcome)

- What is your platform? (Linux, macOS, ...)
- What does `DEBUG=opcuaIIoT:* node-red -v` say? (log files are welcome)

## Feature requests

For feature requests, please raise them on the relevant project's issue tracker.

## Pull-Requests

Please, send your PRs to the **develop** branch!
If you want to raise a pull-request with a new feature, or a refactoring
of existing code, it may well get rejected if you haven't discussed it on the relevant project's issue tracker first.

### Coding standards

Please ensure you follow the coding standards used through-out the existing code base.

Some basic rules include:

- all files must have the BSD 3-Clause license in the header.
- indent with 2-spaces, no tabs. No arguments.
- follow ES6 or above coding standards
- follow standard.js coding standards

Some style suggestions to follow when possible:

- Arrow functions should be prioritized over the function keyword.
- Assign types as narrowly as possible
- Using the `any` type should be avoided unless a variable's type truly doesn't matter.
    - If it is very difficult to deduce an object's type, use the `Todo` type from `src/types/placeholders.ts` instead
      of `any`.
- When writing new code, use functional programming principles when possible.
    - Modifying objects makes the code more complex and harder to read, so favor creating a new object instead.
    - A lot of the existing code doesn't follow this, so use your best judgement.

### Update

### Upgrade

### Return of Code Investment

Please, make pull requests!
If you are not sure how to do this, then ask for help please!
