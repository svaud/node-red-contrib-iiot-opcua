/**
 * Original Work Copyright 2014 IBM Corp.
 * node-red
 *
 * Copyright (c) 2022 DATATRONiQ GmbH (https://datatroniq.com)
 * Copyright (c) 2018-2022 Klaus Landsdorf (http://node-red.plus/)
 * All rights reserved.
 * node-red-contrib-iiot-opcua
 *
 **/

'use strict'

process.env.isTest = 'TRUE'

// jest.setTimeout(30000)

var injectNode = require('@node-red/nodes/core/common/20-inject')
var functionNode = require('@node-red/nodes/core/function/10-function')
var readNode = require('../../src/opcua-iiot-read')

var helper = require('node-red-node-test-helper')
var portHelper = require('./../helper/test-helper-extensions')
helper.init(require.resolve('node-red'))

// iiot opc ua nodes
var inputNode = require('../../src/opcua-iiot-connector')

var nodesToLoadConnector = [injectNode, functionNode, inputNode, readNode]

var testFlows = require('./flows/connector-flows')
const { MessageSecurityMode, SecurityPolicy } = require('node-opcua')

let testingOpcUaPort = 0

describe('OPC UA Connector node Unit Testing', function () {

  beforeAll(() => {
    testingOpcUaPort = 57150
  })

  beforeEach(function (done) {
    helper.startServer(function () {
      done()
    })
  })

  afterEach(function (done) {
    helper.unload().then(function () {
      helper.stopServer(function () {
        done()
      })
    }).catch(function () {
      helper.stopServer(function () {
        done()
      })
    })
  })

  describe('Connector node', function () {
    it('should be loaded without server for the endpoint', function (done) {
      try {
        helper.load(nodesToLoadConnector, testFlows.testUnitConnectorFlow, () => {
          let n4 = helper.getNode('n4')
          if (n4) {
            expect(n4.functions).toBeDefined()
            done()
          }
        })
      } catch (e) {
        done()
      }
    })

    it('should be loaded with no endpoint', function (done) {
      helper.load(nodesToLoadConnector, testFlows.testUnitConnectorFlow, () => {
        let n4 = helper.getNode('n4')
        if (n4) {
          n4.functions.connectToClient()
          n4.functions.connectOPCUAEndpoint()
          done()
        }
      })
    })

    it('should be loaded and execute reset for Bad Session', function (done) {
      helper.load(nodesToLoadConnector, testFlows.testUnitConnectorFlow, () => {
        let n4 = helper.getNode('n4')
        if (n4) {
          n4.functions.resetBadSession()
          done()
        }
      })
    })

    it('should be loaded and do not start session on state END', function (done) {
      helper.load(nodesToLoadConnector, testFlows.testUnitConnectorFlow, () => {
        let n4 = helper.getNode('n4')
        if (n4) {
          //n4.iiot.stateMachine.lock().end()
          n4.iiot.stateService.send('END')

          expect(n4.iiot.stateService.state.value).toBe('end')

          n4.functions.startSession()
          done()
        }
      })
    })

    it('should be loaded and do not start session on state is not OPEN', function (done) {
      helper.load(nodesToLoadConnector, testFlows.testUnitConnectorFlow, () => {
        let n4 = helper.getNode('n4')
        if (n4) {
          //n4.iiot.stateMachine.lock()
          n4.iiot.stateService.send('LOCK')

          expect(n4.iiot.stateService.state.value).toBe('locked')

          n4.functions.startSession()
          done()
        }
      })
    })

    it('should be loaded and do not start session without OPC UA client', function (done) {
      helper.load(nodesToLoadConnector, testFlows.testUnitConnectorFlow, () => {
        let n4 = helper.getNode('n4')
        if (n4) {
          //n4.iiot.stateMachine.lock().open()
          n4.iiot.stateService.send('INITOPCUA')
          n4.iiot.stateService.send('OPEN')

          expect(n4.iiot.stateService.state.value).toBe('opened')

          n4.functions.startSession()
          done()
        }
      })
    })

    // TODO whole new functions

    // Todo: Cannot change state to open in one jump, if the transition doesnt allow it
    it('should be loaded and do restart session on state is not RECONFIGURED', function (done) {
      helper.load(nodesToLoadConnector, testFlows.testUnitConnectorFlow, () => {
        let n4 = helper.getNode('n4')
        if (n4) {
          //n4.iiot.stateMachine.lock().open()
          n4.iiot.stateService.send('INITOPCUA')
          n4.iiot.stateService.send('OPEN')

          expect(n4.iiot.stateService.state.value).toBe('opened')

          n4.functions.renewConnection(done)
        }
      })
    })

    // Todo: Cannot change state to reconfigured in one jump, if the transition doesnt allow it
    it('should be loaded and do restart connection on state is RECONFIGURED', function (done) {
      helper.load(nodesToLoadConnector, testFlows.testUnitConnectorFlow, () => {
        let n4 = helper.getNode('n4')
        if (n4) {
          //n4.iiot.stateMachine.lock().reconfigure()
          n4.iiot.stateService.send('LOCK')
          n4.iiot.stateService.send('RECONFIGURE')

          expect(n4.iiot.stateService.state.value).toBe('reconfigured')

          var test = 0

          n4.functions.renewConnection(done)
        }
      })
    })

    it('should be loaded and do reset BadSession on state is LOCKED', function (done) {
      helper.load(nodesToLoadConnector, testFlows.testUnitConnectorFlow, () => {
        let n4 = helper.getNode('n4')
        if (n4) {
          //n4.iiot.stateMachine.lock()
          n4.iiot.stateService.send('LOCK')

          expect(n4.iiot.stateService.state.value).toBe('locked')

          n4.iiot.sessionNodeRequests = 10
          n4.functions.resetBadSession()
          //setTimeout(done, 1500)
          done()
        }
      })
    })

    it('should be loaded and do reset BadSession on state is RECONFIGURED', function (done) {
      helper.load(nodesToLoadConnector, testFlows.testUnitConnectorFlow, () => {
        let n4 = helper.getNode('n4')
        if (n4) {
          //n4.iiot.stateMachine.lock().reconfigure()
          n4.iiot.stateService.send('LOCK')
          n4.iiot.stateService.send('RECONFIGURE')

          expect(n4.iiot.stateService.state.value).toBe('reconfigured')

          n4.iiot.sessionNodeRequests = 10
          n4.functions.resetBadSession()
          setTimeout(done, 1000)
        }
      })
    })

    it('should be loaded and handle error', function (done) {
      helper.load(nodesToLoadConnector, testFlows.testUnitConnectorFlow, () => {
        let n4 = helper.getNode('n4')
        if (n4) {
          n4.functions.handleError(new Error('Testing Error To Handle'))
          done()
        }
      })
    })

    it('should be loaded and register call done without node', function (done) {
      helper.load(nodesToLoadConnector, testFlows.testUnitConnectorFlow, () => {
        let n4 = helper.getNode('n4')
        if (n4) {
          n4.functions.registerForOPCUA(null)
          done()
        }
      })
    })

    it('should be loaded and deregister call done without node', function (done) {
      helper.load(nodesToLoadConnector, testFlows.testUnitConnectorFlow, () => {
        let n4 = helper.getNode('n4')
        if (n4) {
          n4.functions.deregisterForOPCUA(null, done)
        }
      })
    })

    it('should be loaded with correct defaults', function (done) {
      helper.load(nodesToLoadConnector, testFlows.testUnitConnectorGeneratedDefaultsFlow,
        function () {
          let nodeUnderTest = helper.getNode('594b2860fa40bda5')
          expect(nodeUnderTest.discoveryUrl).toBe(null)
          expect(nodeUnderTest.endpoint).toBe('opc.tcp://localhost:44840/')
          expect(nodeUnderTest.endpointMustExist).toBe(false)
          expect(nodeUnderTest.keepSessionAlive).toBe(true)
          expect(nodeUnderTest.loginEnabled).toBe(false)
          expect(nodeUnderTest.name).toBe('LOCAL SERVER')
          expect(nodeUnderTest.showErrors).toBe(false)
          expect(nodeUnderTest.securityPolicy).toBe(SecurityPolicy.None)
          expect(nodeUnderTest.messageSecurityMode).toBe(MessageSecurityMode.None)
          expect(nodeUnderTest.individualCerts).toBe(false)  // Todo: exists in defaults but not init. expected false, received undefined - wo in server options? Übernehmen in init
          expect(nodeUnderTest.publicCertificateFile).toBe(null)
          expect(nodeUnderTest.privateKeyFile).toBe(null)
          expect(nodeUnderTest.defaultSecureTokenLifetime).toBe('' || 120000)
          expect(nodeUnderTest.autoSelectRightEndpoint).toBe(false)
          expect(nodeUnderTest.strategyMaxRetry).toBe('' || 10000)
          expect(nodeUnderTest.strategyInitialDelay).toBe('' || 1000)
          expect(nodeUnderTest.strategyMaxDelay).toBe('' || 30000)
          expect(nodeUnderTest.strategyRandomisationFactor).toBe('' || 0.2)
          expect(nodeUnderTest.requestedSessionTimeout).toBe('' || 60000)
          expect(nodeUnderTest.connectionStartDelay).toBe(2000) //CONNECTION_START_DELAY
          expect(nodeUnderTest.connectionStopDelay).toBe(2000) //RECONNECT_DELAY //Todo: set to 1000 as const in .ts-file received 2000 - placeholder anpassen
          expect(nodeUnderTest.reconnectDelay).toBe(1000) //CONNECTION_STOP_DELAY //Todo: set to 2000 as const in .ts-file received 1000
          expect(nodeUnderTest.maxBadSessionRequests).toBe(10) // Todo: is set as type number but received "10"
          done()
        })
    })

    // TODO: Figure out why this isn't working
    // it('should success on FilterTypes request', function (done) {
    //   helper.load(nodesToLoadConnector, testFlows.testUnitConnectorFlow, function () {
    //     helper.request()
    //       .get('/opcuaIIoT/list/FilterTypes')
    //       .expect(200)
    //       .end(done)
    //   })
    // })
  })
})
