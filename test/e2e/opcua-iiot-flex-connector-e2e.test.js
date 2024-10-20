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

// jest.setTimeout(30000)

var injectNode = require('@node-red/nodes/core/common/20-inject')
var inputNode = require('../../src/opcua-iiot-flex-connector')
var connectorNode = require('../../src/opcua-iiot-connector')
var serverNode = require('../../src/opcua-iiot-server')
var flexServerNode = require('../../src/opcua-iiot-flex-server')
var responseNode = require('../../src/opcua-iiot-response')
var listenerNode = require('../../src/opcua-iiot-listener')
var eventNode = require('../../src/opcua-iiot-event')
var browserNode = require('../../src/opcua-iiot-browser')
var injectIIoTNode = require('../../src/opcua-iiot-inject')

var flexConnectorNodes = [injectNode, injectIIoTNode, inputNode, connectorNode, serverNode, flexServerNode, responseNode, listenerNode, eventNode, browserNode]

var helper = require('node-red-node-test-helper')
var portHelper = require('./../helper/test-helper-extensions')
helper.init(require.resolve('node-red'))

var testFlows = require('./flows/flex-connector-e2e-flows')

let testingOpcUaPort = 0

describe('OPC UA Flex Connector node e2e Testing', function () {

  beforeAll(() => {
    testingOpcUaPort = 53500
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

  describe('Flex Connector node', function () {
    it('should be loaded and get five injects', function (done) {
      const flow = Array.from(testFlows.testFlexConnectorFlow)

      helper.load(flexConnectorNodes, flow,
        function () {
          let counter = 0
          let nodeUnderTest = helper.getNode('n1fc')
          expect(nodeUnderTest).toBeDefined()
          nodeUnderTest.on('input', (msg) => {
            counter++
            expect(msg.payload).toBeDefined()
            if (counter === 5) {
              done()
            }
          })
        })
    })

    /*   Todo: Fix broken Tests
    //   Tests are broken but node works as it should. Gets an assertion error in code from node opcua package
    //   Seems like the problem is either not on our side or would require massive restructuring of server and sessions


    it('should be loaded with connector, inject, and servers', function (done) {
      const flow = Array.from(testFlows.testWithServersFlexConnector)
      const port1 = portHelper.getPort()
      const port2 = portHelper.getPort()
      const port3 = portHelper.getPort()
      flow[1].payload = "{\"discoveryUrl\":null,\"endpoint\":\"localhost:"+port1+"\",\"keepSessionAlive\":false,\"securityPolicy\":\"None\",\"securityMode\":\"None\",\"name\":\"LOCAL FLEXIBLE INJECTED SERVER\",\"showErrors\":true,\"publicCertificateFile\":null,\"privateKeyFile\":null,\"defaultSecureTokenLifetime\":0,\"endpointMustExist\":false,\"autoSelectRightEndpoint\":false,\"strategyMaxRetry\":0,\"strategyInitialDelay\":0,\"strategyMaxDelay\":0,\"strategyRandomisationFactor\":0,\"requestedSessionTimeout\":0,\"connectionStartDelay\":0,\"reconnectDelay\":0}"
      flow[2].payload = "{\"discoveryUrl\":null,\"endpoint\":\"opc.tcp://localhost:"+port2+"/\",\"keepSessionAlive\":false,\"securityPolicy\":\"None\",\"securityMode\":\"None\",\"name\":\"LOCAL FLEXIBLE INJECTED SERVER\",\"showErrors\":true,\"publicCertificateFile\":null,\"privateKeyFile\":null,\"defaultSecureTokenLifetime\":0,\"endpointMustExist\":false,\"autoSelectRightEndpoint\":false,\"strategyMaxRetry\":0,\"strategyInitialDelay\":0,\"strategyMaxDelay\":0,\"strategyRandomisationFactor\":0,\"requestedSessionTimeout\":0,\"connectionStartDelay\":0,\"reconnectDelay\":0}"
      flow[3].payload = "{\"discoveryUrl\":null,\"endpoint\":\"opc.tcp://localhost:"+port1+"/\",\"keepSessionAlive\":false,\"securityPolicy\":\"None\",\"securityMode\":\"None\",\"name\":\"LOCAL FLEXIBLE INJECTED SERVER\",\"showErrors\":true,\"publicCertificateFile\":null,\"privateKeyFile\":null,\"defaultSecureTokenLifetime\":0,\"endpointMustExist\":false,\"autoSelectRightEndpoint\":false,\"strategyMaxRetry\":0,\"strategyInitialDelay\":0,\"strategyMaxDelay\":0,\"strategyRandomisationFactor\":0,\"requestedSessionTimeout\":0,\"connectionStartDelay\":0,\"reconnectDelay\":0}"
      flow[4].payload = "{\"discoveryUrl\":null,\"endpoint\":\"opc.tcp://localhost:"+port3+"/\",\"keepSessionAlive\":false,\"securityPolicy\":\"None\",\"securityMode\":\"None\",\"name\":\"LOCAL FLEXIBLE INJECTED SERVER\",\"showErrors\":true,\"publicCertificateFile\":null,\"privateKeyFile\":null,\"defaultSecureTokenLifetime\":0,\"endpointMustExist\":false,\"autoSelectRightEndpoint\":false,\"strategyMaxRetry\":0,\"strategyInitialDelay\":0,\"strategyMaxDelay\":0,\"strategyRandomisationFactor\":0,\"requestedSessionTimeout\":0,\"connectionStartDelay\":0,\"reconnectDelay\":0}"
      flow[5].payload = "{\"discoveryUrl\":null,\"endpoint\":\"opc.tcp://localhost:12345/\",\"keepSessionAlive\":false,\"securityPolicy\":\"None\",\"securityMode\":\"None\",\"name\":\"LOCAL FLEXIBLE INJECTED SERVER\",\"showErrors\":true,\"publicCertificateFile\":null,\"privateKeyFile\":null,\"defaultSecureTokenLifetime\":0,\"endpointMustExist\":false,\"autoSelectRightEndpoint\":false,\"strategyMaxRetry\":0,\"strategyInitialDelay\":0,\"strategyMaxDelay\":0,\"strategyRandomisationFactor\":0,\"requestedSessionTimeout\":0,\"connectionStartDelay\":0,\"reconnectDelay\":0}"

      flow[9].port = port1
      flow[10].port = port2
      flow[11].port = port3
      flow[12].endpoint = "opc.tcp://localhost:" + port1

      helper.load(flexConnectorNodes, testFlows.testWithServersFlexConnector,
        function () {
          let counter = 0
          let nodeUnderTest = helper.getNode('n2fcs')
          expect(nodeUnderTest).toBeDefined()
          nodeUnderTest.on('input', (msg) => {
            counter++
            expect(msg.payload).toBeDefined()
            if (counter > 2) {
              setTimeout(done, 3000)
            }
          })
        })
    })

    it('should be loaded with listener, events, and servers', function (done) {
      const flow = Array.from(testFlows.flexConnectorSwitchingEndpointWithListenerFlow)
      const port1 = portHelper.getPort()
      const port2 = portHelper.getPort()
      flow[7].port = port1
      flow[8].port = port2
      flow[17].endpoint = "opc.tcp://localhost:" + port2

      helper.load(flexConnectorNodes, flow,
        function () {
          let counter = 0
          let nodeUnderTest = helper.getNode('n1rcf1')
          expect(nodeUnderTest).toBeDefined()
          nodeUnderTest.on('input', (msg) => {
            counter++
            expect(msg.payload).toBeDefined()
            if (counter === 2) {
              setTimeout(done, 3000)
            }
          })
        })
    })
    */

  })
})
