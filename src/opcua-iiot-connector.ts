/*
 The BSD 3-Clause License

 Copyright 2022 - DATATRONiQ GmbH (https://datatroniq.com)
 Copyright (c) 2018-2022 Klaus Landsdorf (http://node-red.plus/)
 Copyright 2015,2016 - Mika Karaila, Valmet Automation Inc. (node-red-contrib-opcua)
 All rights reserved.
 node-red-contrib-iiot-opcua
 */
'use strict'

import * as path from 'path'
import * as nodered from 'node-red'
import {NodeStatus} from 'node-red'
import {
  ConnectorIIoT,
  FsmConnectorStates,
  getNodeOPCUAClientPath,
  isInitializedIIoTNode,
  resetIiotNode
} from './core/opcua-iiot-core'
import {
  AttributeIds,
  ClientSession,
  coerceMessageSecurityMode,
  coerceSecurityPolicy,
  DataTypeIds,
  EndpointDescription,
  findServers,
  MessageSecurityMode,
  nodesets,
  ObjectTypeIds,
  OPCUAClient,
  ReferenceTypeIds,
  SecurityPolicy,
  StatusCodes,
  VariableTypeIds
} from "node-opcua";
import coreConnector, {logger} from "./core/opcua-iiot-core-connector";
import {FindServerResults} from "node-opcua-client/source/tools/findservers";
import _, {isUndefined} from "underscore";
import {UserTokenType} from "node-opcua-service-endpoints";
import {OPCUAClientOptions} from "node-opcua-client/dist/opcua_client";
import internalDebugLog = logger.internalDebugLog;
import detailDebugLog = logger.detailDebugLog;
import {getEnumKeys} from "./types/helpers";
import {createMachine, interpret} from "@xstate/fsm"
import {TodoTypeAny} from "./types/placeholders";

interface OPCUAIIoTConnectorCredentials {
  user: string
  password: string
}

export type OPCUAIIoTConnectorNode = nodered.Node<OPCUAIIoTConnectorCredentials> & {
  discoveryUrl: string | null
  endpoint: string
  keepSessionAlive: boolean
  loginEnabled: boolean
  securityPolicy: SecurityPolicy
  messageSecurityMode: MessageSecurityMode
  name: string
  showErrors: boolean
  individualCerts: boolean
  publicCertificateFile: string | null
  privateKeyFile: string | null
  defaultSecureTokenLifetime: number
  endpointMustExist: boolean
  autoSelectRightEndpoint: boolean
  strategyMaxRetry: number
  strategyInitialDelay: number
  strategyMaxDelay: number
  strategyRandomisationFactor: number
  requestedSessionTimeout: number
  connectionStartDelay: number
  reconnectDelay: number
  connectionStopDelay: number
  maxBadSessionRequests: number
  securedCommunication?: boolean
  iiot?: ConnectorIIoT
  functions?: {
    [key: string]: Function
  }
  on(event: 'connection_started', listener: (opcuaClient: OPCUAClient) => void): OPCUAIIoTConnectorNode,
  on(event: 'session_started', listener: (opcuaSession: ClientSession) => void): void
  on(event: 'connector_init', listener: (node: Node) => void): void

  on(event: 'server_connection_close' | 'server_connection_abort' | 'connection_closed' | 'server_connection_lost' | 'reset_opcua_connection' | 'session_closed' | 'session_restart' | 'session_error' | 'after_reconnection',
     listener: () => void): void
}

interface OPCUAIIoTConnectorConfigurationDef extends nodered.NodeDef {
  discoveryUrl: string
  endpoint: string
  keepSessionAlive: boolean
  loginEnabled: boolean
  securityPolicy: string
  securityMode: string
  name: string
  showErrors: boolean
  individualCerts: boolean
  publicCertificateFile: string
  privateKeyFile: string
  defaultSecureTokenLifetime: number
  endpointMustExist: boolean
  autoSelectRightEndpoint: boolean
  strategyMaxRetry: number
  strategyInitialDelay: number
  strategyMaxDelay: string
  strategyRandomisationFactor: number
  requestedSessionTimeout: number
  connectionStartDelay: number
  reconnectDelay: number
  connectionStopDelay: number
  maxBadSessionRequests: number
}

/**
 * OPC UA connector Node-RED config this.
 *
 * @param RED
 */
module.exports = function (RED: nodered.NodeAPI) {
  // SOURCE-MAP-REQUIRED

  function OPCUAIIoTConnectorConfiguration(
    this: OPCUAIIoTConnectorNode, config: OPCUAIIoTConnectorConfigurationDef) {
    const CONNECTION_START_DELAY = 2000 // msec.
    const CONNECTION_STOP_DELAY = 2000 // msec.
    const RECONNECT_DELAY = 1000 // msec.
    const UNLIMITED_LISTENERS = 0

    RED.nodes.createNode(this, config)
    // HTML settings
    this.discoveryUrl = config.discoveryUrl || null
    this.endpoint = config.endpoint
    this.endpointMustExist = config.endpointMustExist || false
    this.keepSessionAlive = config.keepSessionAlive
    this.loginEnabled = config.loginEnabled
    this.name = config.name
    this.showErrors = config.showErrors
    this.securityPolicy = coerceSecurityPolicy(config.securityPolicy)
    this.messageSecurityMode = coerceMessageSecurityMode(config.securityMode) || MessageSecurityMode.None
    this.individualCerts = config.individualCerts
    this.publicCertificateFile = config.publicCertificateFile
    this.privateKeyFile = config.privateKeyFile
    this.defaultSecureTokenLifetime = config.defaultSecureTokenLifetime || 120000
    this.autoSelectRightEndpoint = config.autoSelectRightEndpoint
    this.strategyMaxRetry = config.strategyMaxRetry || 10000
    this.strategyInitialDelay = config.strategyInitialDelay || 1000
    this.strategyMaxDelay = parseInt(config.strategyMaxDelay) || 30000
    this.strategyRandomisationFactor = config.strategyRandomisationFactor || 0.2
    this.requestedSessionTimeout = config.requestedSessionTimeout || 60000
    this.connectionStartDelay = config.connectionStartDelay || CONNECTION_START_DELAY
    this.reconnectDelay = config.reconnectDelay || RECONNECT_DELAY
    this.connectionStopDelay = config.connectionStopDelay || CONNECTION_STOP_DELAY
    this.maxBadSessionRequests = parseInt(config.maxBadSessionRequests?.toString()) || 10

    this.iiot = coreConnector.initConnectorNode()

    if (!this.iiot) throw Error('IIoT Initialization Failed')

    this.setMaxListeners(UNLIMITED_LISTENERS)

    const self = this

    internalDebugLog('Open Connector Node')

    let sessionStartTimeout: NodeJS.Timeout | null
    let clientStartTimeout: NodeJS.Timeout | null
    let disconnectTimeout: NodeJS.Timeout | null
    let nodeOPCUAClientPath = getNodeOPCUAClientPath()

    this.securedCommunication = (
      this.securityPolicy !== SecurityPolicy.None &&
      this.messageSecurityMode !== MessageSecurityMode.None
    )

    detailDebugLog('config: ' + this.publicCertificateFile)
    detailDebugLog('config: ' + this.privateKeyFile)
    detailDebugLog('securedCommunication: ' + this.securedCommunication.toString())

    const initCertificatesAndKeys = () => {
      if (this.securedCommunication) {
        this.publicCertificateFile = this.publicCertificateFile || path.join(nodeOPCUAClientPath, '/certificates/client_selfsigned_cert_1024.pem')
        detailDebugLog('using cert: ' + this.publicCertificateFile)

        this.privateKeyFile = this.privateKeyFile || path.join(nodeOPCUAClientPath, '/certificates/PKI/own/private/private_key.pem')
        detailDebugLog('using key: ' + this.privateKeyFile)
      } else {
        this.publicCertificateFile = null
        this.privateKeyFile = null
      }
    }

    if (this.loginEnabled) {
      if (this.credentials) {
        this.iiot.userIdentity = {
          type: UserTokenType.UserName,
          userName: this.credentials.user,
          password: this.credentials.password
        }
        internalDebugLog('Connecting With Login Data On ' + this.endpoint)
      } else {
        /* istanbul ignore next */
        this.error(new Error('Login Enabled But No Credentials'), {payload: ''})
      }
    }

    /*  #########   CONNECTION  #########     */

    const getUpdatedServerOptions = (): OPCUAClientOptions => {
      initCertificatesAndKeys()
      return {
        securityPolicy: this.securityPolicy,
        securityMode: this.messageSecurityMode,
        defaultSecureTokenLifetime: this.defaultSecureTokenLifetime,
        keepSessionAlive: this.keepSessionAlive,
        certificateFile: this.publicCertificateFile ?? undefined,
        privateKeyFile: this.privateKeyFile ?? undefined,
        endpointMustExist: this.endpointMustExist,
        requestedSessionTimeout: this.requestedSessionTimeout,
        connectionStrategy: {
          maxRetry: this.strategyMaxRetry,
          initialDelay: this.strategyInitialDelay,
          maxDelay: this.strategyMaxDelay,
          randomisationFactor: this.strategyRandomisationFactor
        }
      }
    }

    const statusHandler = (status: string | NodeStatus): void => {
      this.status(status)
    }

    const errorHandler = (err: Error): void => {
      this.error(err)
    }

    const connectOPCUAEndpoint = async () => {
      if (isUndefined(this.iiot))
        return
      if (!coreConnector.checkEndpoint(this.endpoint, errorHandler)) {
        return
      }

      internalDebugLog('Connecting To Endpoint ' + this.endpoint)

      this.iiot.opcuaClientOptions = getUpdatedServerOptions()

      if (!this.iiot.opcuaClient)
        this.iiot.opcuaClient = OPCUAClient.create({...this.iiot.opcuaClientOptions}) // Need to use the spread operator, because otherwise there is phantom circular references
      if (Object.keys(this.iiot.opcuaClient).length === 0) {
        /* istanbul ignore next */
        detailDebugLog('Failed to create OPCUA Client ', {opcuaClient: this.iiot.opcuaClient})
      }

      if (this.autoSelectRightEndpoint) {
        autoSelectEndpointFromConnection()
      }
      // coreConnector.setListenerToClient(node)
      connectToClient()
    }

    const connectToClient = () => {
      if (isUndefined(this.iiot))
        return

      if(isUndefined(this.iiot.stateService))
        return

      // Needs to be separate if so that typescript understands the types properly
      if (isUndefined(this.iiot.opcuaClient))
        return

      if (!coreConnector.checkEndpoint(this.endpoint, errorHandler)) {
        return
      }
      this.iiot.opcuaClient.connect(this.endpoint, (err: Error | undefined): void => {
        if (isInitializedIIoTNode(this) && !isUndefined(this.iiot) && !isUndefined(this.iiot.stateService)) {
          if (err) {
            //this.iiot.stateMachine.lock().stopopcua()
            this.iiot?.stateService.send('STOP')
            handleError(err)
          } else {
            internalDebugLog('Client Is Connected To ' + this.endpoint)
            //this.iiot.stateMachine.open()
            this.iiot.stateService.send('OPEN')
          }
        } else {
          /* istanbul ignore next */
          internalDebugLog('iiot not valid on connect resolve')
        }
      })
    }

    const renewConnection = (done: () => void) => {
      if (isInitializedIIoTNode<ConnectorIIoT>(this.iiot)) {
        opcuaDirectDisconnect(() => {
          if (isUndefined(this.iiot)) return;
          renewFiniteStateMachine()
          //this.iiot.stateMachine.idle().initopcua();
          // Todo: the steps have to be used as before
          this.iiot.stateService.send('IDLE')
          this.iiot.stateService.send('INITOPCUA')
          done()
        })
      } else {
        /* istanbul ignore next */
        internalDebugLog('iiot not valid on renew connection')
      }
    }

    const endpointMatchForConnecting = (endpoint: EndpointDescription) => {
      internalDebugLog('Auto Endpoint ' + endpoint.endpointUrl?.toString() + ' ' + endpoint.securityPolicyUri?.toString())
      let securityMode = endpoint.securityMode
      let securityPolicy = (endpoint.securityPolicyUri?.includes('SecurityPolicy#')) ? endpoint.securityPolicyUri.split('#')[1] : endpoint.securityPolicyUri

      internalDebugLog('node-mode:' + this.messageSecurityMode + ' securityMode: ' + securityMode)
      internalDebugLog('node-policy:' + this.securityPolicy + ' securityPolicy: ' + securityPolicy)

      return (securityMode === this.messageSecurityMode && securityPolicy === this.securityPolicy)
    }

    const selectEndpointFromSettings = (discoverClient: OPCUAClient) => {
      discoverClient.getEndpoints((err, endpoints) => {
        if (err) {
          /* istanbul ignore next */
          internalDebugLog('Auto Switch To Endpoint Error ' + err)
          if (this.showErrors) {
            this.error(err, {payload: 'Get Endpoints Request Error'})
          }
        } else {
          const endpoint = (endpoints || []).find((endpoint) => {
            endpointMatchForConnecting(endpoint)
          })

          if (endpoint && endpoint.endpointUrl != null) {
            /* istanbul ignore next */
            internalDebugLog('Auto Switch To Endpoint ' + endpoint.endpointUrl)
            this.endpoint = endpoint.endpointUrl
          } else {
            internalDebugLog('Auto Switch To Endpoint failed: no valid endpoints')
          }
        }

        discoverClient.disconnect((err: Error | undefined) => {
          if (err) {
            /* istanbul ignore next */
            internalDebugLog('Endpoints Auto Request Error ' + err)
            if (this.showErrors) {
              /* istanbul ignore next */
              this.error(err, {payload: 'Discover Client Disconnect Error'})
            }
          } else {
            internalDebugLog('Endpoints Auto Request Done With Endpoint ' + this.endpoint)
          }
        })
      })
    }

    const autoSelectEndpointFromConnection = () => {
      internalDebugLog('Auto Searching For Endpoint On ' + this.endpoint)

      if (isUndefined(this.iiot) || isUndefined(this.iiot.opcuaClientOptions))
        return

      let endpointMustExist = this.iiot.opcuaClientOptions.endpointMustExist
      this.iiot.opcuaClientOptions.endpointMustExist = false

      let discoverClient = OPCUAClient.create(this.iiot.opcuaClientOptions)

      discoverClient.connect(this.endpoint).then(() => {
        internalDebugLog('Auto Searching Endpoint Connected To ' + this.endpoint)
        selectEndpointFromSettings(discoverClient)
        if (isUndefined(this.iiot) || isUndefined(this.iiot.opcuaClientOptions))
          return

        this.iiot.opcuaClientOptions.endpointMustExist = endpointMustExist
      }).catch((err: Error) => {
        /* istanbul ignore next */
        internalDebugLog('Get Auto Endpoint Request Error ' + err.message)
        if (isInitializedIIoTNode<ConnectorIIoT>(this.iiot) && !isUndefined(this.iiot.opcuaClientOptions)) {
          this.iiot.opcuaClientOptions.endpointMustExist = endpointMustExist
        }
      })
    }

    /*  #########    SESSION    #########     */

    const startSession = async (callerInfo: string) => {
      internalDebugLog('Request For New Session From ' + callerInfo)
      if (isUndefined(this.iiot)) {
        /* istanbul ignore next */
        return
      }

      if (isInactiveOnOPCUA()) {
        internalDebugLog('State Is Not Active While Start Session-> ' + this.iiot.stateService.state.value)
        if (this.showErrors) {
          /* istanbul ignore next */
          this.error(new Error('OPC UA Connector Is Not Active'), {payload: 'Create Session Error'})
        }
        return
      }

      if (this.iiot.stateService.state.value !== FsmConnectorStates.StateOpened) {
        internalDebugLog('Session Request Not Allowed On State ' + this.iiot.stateService.state.value)
        if (this.showErrors) {
          /* istanbul ignore next */
          this.error(new Error('OPC UA Connector Is Not Open'), {payload: 'Create Session Error'})
        }
        return
      }

      if (!this.iiot.opcuaClient) {
        internalDebugLog('OPC UA Client Connection Is Not Valid On State ' + this.iiot.stateService.state.value)
        if (this.showErrors) {
          /* istanbul ignore next */
          this.error(new Error('OPC UA Client Connection Is Not Valid'), {payload: 'Create Session Error'})
        }
        return
      }

      //this.iiot.stateMachine.sessionrequest()
      this.iiot.stateService.send('SESSIONREQUEST')
      const res = await this.iiot.opcuaClient.createSession(this.iiot.userIdentity)
        .then((session: ClientSession) => {
          if (isUndefined(this.iiot)) return

          session.requestedMaxReferencesPerNode = 100000
          this.iiot.opcuaSession = session
          //this.iiot.stateMachine.sessionactive()
          this.iiot.stateService.send('SESSIONACTIVATE')

          detailDebugLog('Session Created On ' + this.endpoint + ' For ' + callerInfo)
          coreConnector.logSessionInformation(this)

          this.iiot.opcuaSession?.on('session_closed', (statusCode: number) => {
            handleSessionClose(statusCode)
          })
        }).catch((err: Error) => {
            /* istanbul ignore next */
          if (isInitializedIIoTNode<ConnectorIIoT>(this.iiot)) {
            //this.iiot.stateMachine.lock().stopopcua()
            this.iiot.stateService.send('LOCK')
            this.iiot.stateService.send('STOP')
            handleError(err)
          } else {
            internalDebugLog(err.message)
          }
          this.emit('session_error', err)
          return -1
        })
    }

    const resetBadSession = () => {
      if (!this.iiot) {
        /* istanbul ignore next */
        return
      }

      this.iiot.sessionNodeRequests += 1
      detailDebugLog('Session Node Requests At Connector No.: ' + this.iiot.sessionNodeRequests)
      if (this.showErrors) {
        /* istanbul ignore next */
        internalDebugLog('!!!!!!!!!!!!!!!!!!!!!   BAD SESSION ON CONNECTOR   !!!!!!!!!!!!!!!!!!')
      }

      if (this.iiot.sessionNodeRequests > this.maxBadSessionRequests) {
        internalDebugLog('Reset Bad Session Request On State ' + this.iiot.stateService.state.value)
        resetOPCUAConnection('ToManyBadSessionRequests')
      }
    }

    const isInactiveOnOPCUA = () => {
      //let state = this.iiot?.stateMachine?.getMachineState()
      let state = this.iiot?.stateService?.state.value
      return (state === FsmConnectorStates.StateStopped ||
              state === FsmConnectorStates.StateEnd ||
              state === FsmConnectorStates.StateRenewed ||
              state === FsmConnectorStates.StateReconfigured)
    }

    const resetOPCUAConnection = (callerInfo: string) => {
      detailDebugLog(callerInfo + ' Request For New OPC UA Connection')
      if (isInactiveOnOPCUA() || isUndefined(this.iiot)) {
        return
      }

      //this.iiot.stateMachine.lock().renew()
      this.iiot.stateService.send('LOCK')
      this.iiot.stateService.send('RENEW')
      this.emit('reset_opcua_connection')
      closeSession(() => {
        renewConnection(() => {
          detailDebugLog('OPC UA Connection Reset Done')
        })
      })
    }

    const handleError = (err: Error) => {
      internalDebugLog('Handle Error On ' + this.endpoint + ' err: ' + err)
      if (this.showErrors) {
        /* istanbul ignore next */
        this.error(err, {payload: 'Handle Connector Error'})
      }
    }

    const closeSession = (done: () => void) => {
      if (isUndefined(this.iiot) || _.isEmpty(this.iiot)) {
        /* istanbul ignore next */
        done()
        return
      }

      if (this.iiot?.opcuaClient && this.iiot?.opcuaSession) {
        detailDebugLog('Close Session And Remove Subscriptions From Session On State ' + this.iiot.stateService.state.value)

        try {
          this.iiot.opcuaSession.removeAllListeners()
          this.iiot.opcuaClient.closeSession(this.iiot.opcuaSession, this.iiot.hasOpcUaSubscriptions, (err?: Error) => {
            if (err) {
              handleError(err)
            }
            done()
          })
        } catch (err: any) {
          /* istanbul ignore next */
          handleError(err)
          done()
        } finally {
          if (this.iiot)
            this.iiot.opcuaSession = undefined
        }
      } else {
        internalDebugLog('Close Session Without Session On State ' + this.iiot.stateService.state.value)
        done()
      }
    }

    const hasNoSession = () => {
      return _.isUndefined(this.iiot) || _.isUndefined(this.iiot?.opcuaSession) || _.isNull(this.iiot?.opcuaSession)
    }

    const hasSession = () => {
      return !hasNoSession()
    }

    const handleSessionClose = (statusCode: number) => {
      internalDebugLog('Session Closed With StatusCode ' + statusCode)
      if (isUndefined(this.iiot)) {
        return
      }

      if (isInactiveOnOPCUA()) {
        detailDebugLog('Connector Is Not Active On OPC UA While Session Close Event')
        return
      }


      coreConnector.logSessionInformation(this)
      if (this.iiot?.stateMachine && this.iiot.stateService.state.value !== FsmConnectorStates.StateSessionRestart) {
        //this.iiot.stateMachine.lock().sessionclose()
        this.iiot.stateService.send('LOCK')
        this.iiot.stateService.send('SESSIONCLOSE')
      }
    }

    const disconnectNodeOPCUA = (done: () => void) => {
      if (isUndefined(this.iiot) || _.isEmpty(this.iiot)) {
        done()
        return
      }

      internalDebugLog('OPC UA Disconnect Connector On State ' + this.iiot.stateService.state.value)

      if (this.iiot?.opcuaClient) {
        internalDebugLog('Close Node Disconnect Connector From ' + this.endpoint)
        try {
          this.iiot.opcuaClient.disconnect((err?: Error) => {
            if (err) {
              handleError(err)
            }
            internalDebugLog('Close Node Done For Connector On ' + this.endpoint)
            done()
          })
        } catch (err: any) {
          handleError(err)
          done()
        } finally {
          this.iiot.opcuaClient = undefined
        }
      } else {
        internalDebugLog('Close Node Done For Connector Without Client On ' + this.endpoint)
        done()
      }
    }

    this.on('close', (done: () => void) => {
      self.removeAllListeners()

      if (isUndefined(this.iiot) || _.isEmpty(this.iiot)) {
        done()
        return
      }

      if (!isInitializedIIoTNode<ConnectorIIoT>(this.iiot)) {
        done() // if we have a very fast deploy clicking uer
      } else {
        if (isInactiveOnOPCUA()) {
          detailDebugLog('OPC UA Client Is Not Active On Close Node')
          resetIiotNode(this)
          done()
        } else {
          detailDebugLog('OPC UA Client Is Active On Close Node With State ' + this.iiot.stateService.state.value)
          if (this.iiot.stateService.state.value === FsmConnectorStates.StateSessionActive) {
            closeConnector(() => {
              resetIiotNode(this)
              done()
            })
          } else {
            internalDebugLog(this.iiot.stateService.state.value + ' -> !!!  CHECK CONNECTOR STATE ON CLOSE  !!!')
            resetIiotNode(this)
            done()
          }
        }
      }
    })

    const opcuaDisconnect = (done: () => void) => {

      if ( isUndefined(this.iiot) ||
           isUndefined(this.iiot.registeredNodeList) ||
          _.isEmpty(this.iiot) ||
          _.isArray(this.iiot.registeredNodeList) === false)
      {
        opcuaDirectDisconnect(done)
        return
      }

      if (Object.keys(this.iiot.registeredNodeList).length > 0) {
        internalDebugLog('Connector Has Registered Nodes And Can Not Close The Node -> Count: ' + this.iiot.registeredNodeList.length)
        if (disconnectTimeout) {
          clearTimeout(disconnectTimeout)
          disconnectTimeout = null
        }
        disconnectTimeout = setTimeout(() => {
          if (isInitializedIIoTNode(this.iiot)) {
            closeConnector(done)
          }
        }, this.connectionStopDelay)
      } else {
        opcuaDirectDisconnect(done)
      }
    }

    const opcuaDirectDisconnect = (done: () => void) => {
      if (isUndefined(this.iiot) || _.isEmpty(this.iiot)) {
        done()
        return
      }

      detailDebugLog('OPC UA Disconnect From Connector ' + this.iiot.stateService.state.value)
      disconnectNodeOPCUA(() => {
        if (isUndefined(this.iiot)) {
          done()
          return
        }
        //this.iiot.stateMachine.lock().close()
        this.iiot.stateService.send('LOCK')
        this.iiot.stateService.send('CLOSE')
        let fsmState = this.iiot.stateService.state.value
        detailDebugLog('Disconnected On State ' + fsmState)
        // if (!isInactiveOnOPCUA() && fsmState !== 'CLOSED') { //Todo: check state machine to be closed
        //    return;
        // }
        done()
      })
    }

    const closeConnector = (done: () => void) => {
      if (isUndefined(this.iiot)) {
        return
      }
      detailDebugLog('Close Connector ' + this.iiot.stateService.value)

      if (isInactiveOnOPCUA()) {
        detailDebugLog('OPC UA Client Is Not Active On Close Connector')
        done()
        return
      }

      if (this.iiot.opcuaClient) {
        opcuaDisconnect(done)
      } else {
        detailDebugLog('OPC UA Client Is Not Valid On Close Connector')
        done()
      }
    }

    const restartWithNewSettings = (config: OPCUAIIoTConnectorConfigurationDef, done: () => void) => {
      if (isUndefined(this.iiot)) {
        return
      }
      internalDebugLog('Renew With Flex Connector Request On State ' + this.iiot.stateService.state.value)
      //this.iiot.stateMachine.lock().reconfigure()
      this.iiot.stateService.send('LOCK')
      this.iiot.stateService.send('RECONFIGURE')
      updateSettings(config)
      initCertificatesAndKeys()
      renewConnection(done)
    }

    const normalizeCapitalization = (input: string): string => {
      if (!input.length) return input
      return input[0].toUpperCase() + input.substring(1).toLowerCase()
    }

    const updateSettings = (config: OPCUAIIoTConnectorConfigurationDef) => {
      this.discoveryUrl = config.discoveryUrl || this.discoveryUrl
      this.endpoint = config.endpoint || this.endpoint
      this.keepSessionAlive = config.keepSessionAlive || this.keepSessionAlive
      this.securityPolicy = coerceSecurityPolicy(config.securityPolicy || this.securityPolicy)
      this.messageSecurityMode = coerceMessageSecurityMode(normalizeCapitalization((config.securityMode || this.messageSecurityMode) as string))
      this.name = config.name || this.name
      this.showErrors = config.showErrors || this.showErrors
      this.publicCertificateFile = config.publicCertificateFile || this.publicCertificateFile
      this.privateKeyFile = config.privateKeyFile || this.privateKeyFile
      this.defaultSecureTokenLifetime = config.defaultSecureTokenLifetime || this.defaultSecureTokenLifetime
      this.endpointMustExist = config.endpointMustExist || this.endpointMustExist
      this.autoSelectRightEndpoint = config.autoSelectRightEndpoint || this.autoSelectRightEndpoint
      this.strategyMaxRetry = config.strategyMaxRetry || this.strategyMaxRetry
      this.strategyInitialDelay = config.strategyInitialDelay || this.strategyInitialDelay
      this.strategyMaxDelay = parseInt(config.strategyMaxDelay) || this.strategyMaxDelay
      this.strategyRandomisationFactor = config.strategyRandomisationFactor || this.strategyRandomisationFactor
      this.requestedSessionTimeout = config.requestedSessionTimeout || this.requestedSessionTimeout
      this.connectionStartDelay = config.connectionStartDelay || this.connectionStartDelay
      this.reconnectDelay = config.reconnectDelay || this.reconnectDelay
    }

    const resetOPCUAObjects = () => {
      if (isUndefined(this.iiot)) {
        return
      }
      detailDebugLog('Reset All OPC UA Objects')
      this.iiot.sessionNodeRequests = 0
      if (this.iiot.opcuaSession) {
        if (this.iiot.opcuaClient) {
          this.iiot.opcuaClient.closeSession(this.iiot.opcuaSession, true)
        }
        this.iiot.opcuaSession.removeAllListeners()
        this.iiot.opcuaSession = undefined
      }
      if (Object.keys(this.iiot.opcuaClient || {}).length > 1) {
        this.iiot.opcuaClient?.removeAllListeners()
        this.iiot.opcuaClient?.disconnect((err?: Error) => {
          if (err && !isUndefined(this.iiot)) {
            handleError(err)
          }
        })
        this.iiot.opcuaClient = undefined
      }
    }

    /* #########   FSM   #########     */

    const connectorStateEventFunction = async (state: any) =>{
      if(!state.changed) return;
      if(this.iiot === undefined) return;

      switch (state.value) {
        case FsmConnectorStates.StateIdle:
          detailDebugLog('Connector IDLE Event FSM')
          resetOPCUAObjects()
          break
        case FsmConnectorStates.StateInit:
          detailDebugLog('Connector Init OPC UA Event FSM')

          if (!this.iiot) {
            return
          }

          resetOPCUAObjects()
          resetAllTimer()
          this.emit('connector_init', this)
          initCertificatesAndKeys()

          if (clientStartTimeout) {
            clearTimeout(clientStartTimeout)
            clientStartTimeout = null
          }
          detailDebugLog('connecting OPC UA with delay of msec: ' + this.connectionStartDelay)
          clientStartTimeout = setTimeout(() => {
            if (isInitializedIIoTNode(this.iiot)) {
              try {
                connectOPCUAEndpoint()
              } catch (err: any) {
                handleError(err)
                resetOPCUAObjects()
                //this.iiot.stateMachine.lock().stopopcua()
                this.iiot.stateService.send('LOCK')
                this.iiot.stateService.send('STOP')
              }
            }
          }, this.connectionStartDelay)
          break
        case FsmConnectorStates.StateOpened:
          detailDebugLog('Connector Open Event FSM')
          if (isInitializedIIoTNode(this.iiot)) {
            this.emit('connection_started', this.iiot.opcuaClient, statusHandler)
            internalDebugLog('Client Connected To ' + this.endpoint)
            detailDebugLog('Client Options ' + JSON.stringify(this.iiot.opcuaClientOptions))
            await startSession('Open Event')
          }
          break
        case FsmConnectorStates.StateSessionRequested:
          detailDebugLog('Connector Session Request Event FSM')
          break
        case FsmConnectorStates.StateSessionActive:
          detailDebugLog('Connector Session Active Event FSM')
          if (!isUndefined(this.iiot))
            this.iiot.sessionNodeRequests = 0
          this.emit('session_started', this.iiot?.opcuaSession)
          break
        case FsmConnectorStates.StateSessionRestart:
          detailDebugLog('Connector Session Restart Event FSM')
          this.emit('session_restart')
          break
        case FsmConnectorStates.StateSessionClosed:
          detailDebugLog('Connector Session Close Event FSM')
          this.emit('session_closed')
          if (isInitializedIIoTNode(this.iiot)) {
            this.iiot.opcuaSession = undefined
          }
          break
        case FsmConnectorStates.StateClosed:
          detailDebugLog('Connector Client Close Event FSM')
          this.emit('connection_closed')
          if (isInitializedIIoTNode(this.iiot)) {
            if (Object.keys(this.iiot.opcuaClient || {}).length > 1) {
              this.iiot.opcuaClient?.disconnect((err?: Error) => {
                if (err) {
                  handleError(err)
                }
              })
              this.iiot.opcuaClient = undefined
            }
          }
          break
        case FsmConnectorStates.StateLocked:
          detailDebugLog('Connector Lock Event FSM')
          break
        case FsmConnectorStates.StateUnlocked:
          detailDebugLog('Connector Unlock Event FSM')
          break
        case FsmConnectorStates.StateStopped:
          detailDebugLog('Connector Stopped Event FSM')
          this.emit('connection_stopped')
          if (isInitializedIIoTNode(this.iiot)) {
            resetAllTimer()
          }
          break
        case FsmConnectorStates.StateEnd:
          detailDebugLog('Connector End Event FSM')
          this.emit('connection_end')
          if (isInitializedIIoTNode(this.iiot)) {
            resetAllTimer()
          }
          break
        case FsmConnectorStates.StateReconfigured:
          detailDebugLog('Connector Reconfigure Event FSM')
          this.emit('connection_reconfigure')
          if (isInitializedIIoTNode(this.iiot)) {
            resetAllTimer()
          }
          break
        case FsmConnectorStates.StateRenewed:
          detailDebugLog('Connector Renew Event FSM')
          this.emit('connection_renew')
          if (isInitializedIIoTNode(this.iiot)) {
            resetAllTimer()
          }
          break
        default:
          throw new Error('Connector FSM is not in a valid state')
      }

    }

    this.iiot.stateMachine = coreConnector.createConnectorFinalStateMachine()
    this.iiot.stateService = coreConnector.startConnectorMachineService(this.iiot.stateMachine)
    this.iiot.stateSubscription = coreConnector.subscribeConnectorFSMService(this.iiot.stateService, connectorStateEventFunction)



    const resetAllTimer = () => {
      detailDebugLog('Reset All Timer')
      if (clientStartTimeout) {
        clearTimeout(clientStartTimeout)
        clientStartTimeout = null
      }

      if (sessionStartTimeout) {
        clearTimeout(sessionStartTimeout)
        sessionStartTimeout = null
      }

      if (disconnectTimeout) {
        clearTimeout(disconnectTimeout)
        disconnectTimeout = null
      }
    }

    /*  ---------------------  handle config node behaviour --------------------- */
    this.iiot.registeredNodeList = {}

    const renewFiniteStateMachine = () => {
      if (isUndefined(this.iiot))
        return
      this.iiot.stateMachine = null
      this.iiot.stateService = null
      this.iiot.stateSubscription = null

      // @xstate/fsm
      this.iiot.stateMachine = coreConnector.createConnectorFinalStateMachine()
      this.iiot.stateService = coreConnector.startConnectorMachineService(this.iiot.stateMachine)
      this.iiot.stateSubscription = coreConnector.subscribeConnectorFSMService(this.iiot.stateService, connectorStateEventFunction)
    }

    const registerForOPCUA = (opcuaNode: nodered.Node, onAlias: (event: string, ...args: any) => void) => {
      if (!opcuaNode) {
        internalDebugLog('Node Not Valid To Register In Connector')
        return
      }

      internalDebugLog('Register In Connector NodeId: ' + opcuaNode.id)

      if (!this.iiot || isUndefined(this.iiot.registeredNodeList)) {
        internalDebugLog('Node Not Initialized With a registeredNodeList To Register In Connector')
        return
      }

      this.iiot.registeredNodeList[opcuaNode.id] = opcuaNode

      onAlias('opcua_client_not_ready', () => {
        if (isInitializedIIoTNode(this.iiot) && this.iiot.stateService.state.value !== FsmConnectorStates.StateEnd) {
          resetBadSession()
        }
      })

      if (Object.keys(this.iiot.registeredNodeList).length === 1) {
        internalDebugLog('Start Connector OPC UA Connection')
        renewFiniteStateMachine()
        this.iiot.stateService.send('INITOPCUA');
      } else {
      }
    }

    const deregisterForOPCUA = (opcuaNode: nodered.Node, done: () => void) => {
      if (!opcuaNode) {
        internalDebugLog('Node Not Valid To Deregister In Connector')
        done()
        return
      }

      opcuaNode.removeAllListeners('opcua_client_not_ready')

      if (!this.iiot || isUndefined(this.iiot.registeredNodeList)) {
        internalDebugLog('Node Not Initialized With a registeredNodeList To Deregister In Connector')
        return
      }

      internalDebugLog('Deregister In Connector NodeId: ' + opcuaNode.id)
      delete this.iiot.registeredNodeList[opcuaNode.id]

      if (this.iiot.stateService.state.value === FsmConnectorStates.StateStopped || this.iiot.stateService.state.value === FsmConnectorStates.StateEnd) {
        done()
        return
      }

      if (Object.keys(this.iiot.registeredNodeList).length === 0) {
        //this.iiot.stateMachine.lock().stopopcua()
        this.iiot.stateService.send('LOCK')
        this.iiot.stateService.send('STOP')
        if (this.iiot.opcuaClient) {
          detailDebugLog('OPC UA Direct Disconnect On Unregister Of All Nodes')
          try {
            this.iiot.opcuaClient.disconnect((err?: Error) => {
              if (err) {
                handleError(err)
              }
              done()
            })
          } catch (err: any) {
            handleError(err)
            done()
          } finally {
            this.iiot.opcuaClient.removeAllListeners()
          }
        } else {
          done()
        }
      } else {
        done()
      }
    }

    renewFiniteStateMachine()

    this.functions = {
      restartWithNewSettings,
      registerForOPCUA,
      deregisterForOPCUA,
      getUpdatedServerOptions,
      hasNoSession,
      hasSession,
      startSession
    }

    if (process.env.isTest == 'TRUE') {
      this.functions = {
        ...this.functions,
        registerForOPCUA,
        connectToClient,
        connectOPCUAEndpoint,
        resetBadSession,
        renewConnection,
        handleError,
        deregisterForOPCUA,
      }
    }
  }


  try {
    RED.nodes.registerType('OPCUA-IIoT-Connector', OPCUAIIoTConnectorConfiguration, {
      credentials: {
        user: {type: 'text'},
        password: {type: 'password'}
      }
    })
  } catch (e: any) {
    internalDebugLog(e.message)
  }

  /*  ---------------------  HTTP Requests --------------------- */

  RED.httpAdmin.get('/opcuaIIoT/client/discover/:id/:discoveryUrl', RED.auth.needsPermission('opcua.discovery'), function (req, res) {
    let node = RED.nodes.getNode(req.params.id) as OPCUAIIoTConnectorNode
    let discoverUrlRequest = decodeURIComponent(req.params.discoveryUrl)
    internalDebugLog('Get Discovery Request ' + JSON.stringify(req.params) + ' for ' + discoverUrlRequest)
    if (node) {
      if (discoverUrlRequest && !discoverUrlRequest.includes('opc.tcp://')) {
        res.json([])
      } else {
        findServers(discoverUrlRequest, function (err: Error | null, results?: FindServerResults) {
          if (!err && results) {
            const endpoints = results.servers.flatMap((server) => server.discoveryUrls)
            res.json(endpoints)
          } else {
            internalDebugLog('Perform Find Servers Request ' + err)
            if (node.showErrors) {
              node.error(err, {payload: ''})
            }
            res.json([])
          }
        })
      }
    } else {
      internalDebugLog('Get Discovery Request None Node ' + JSON.stringify(req.params))
      res.json([])
    }
  })

  RED.httpAdmin.get('/opcuaIIoT/client/endpoints/:id/:endpointUrl', RED.auth.needsPermission('opcua.endpoints'), function (req, res) {
    let node = RED.nodes.getNode(req.params.id) as OPCUAIIoTConnectorNode
    let endpointUrlRequest = decodeURIComponent(req.params.endpointUrl)
    internalDebugLog('Get Endpoints Request ' + JSON.stringify(req.params) + ' for ' + endpointUrlRequest)
    if (isUndefined(node.iiot)) {
      node.error('IIoT invalid')
      return;
    }
    if (node) {
      if (endpointUrlRequest && !endpointUrlRequest.includes('opc.tcp://')) {
        res.json([])
      } else {
        if (!node.iiot?.opcuaClientOptions) {
          node.iiot.opcuaClientOptions = node.functions?.getUpdatedServerOptions()
        }
        let discoveryClient = OPCUAClient.create({
          ...node.iiot.opcuaClientOptions,
          endpointMustExist: false
        })
        discoveryClient.connect(endpointUrlRequest).then(() => {
          internalDebugLog('Get Endpoints Connected For Request')
          discoveryClient.getEndpoints(function (err, endpoints) {
            if (err) {
              if (node.showErrors) {
                node.error(err, {payload: ''})
              }
              internalDebugLog('Get Endpoints Request Error ' + err)
              res.json([])
            } else {
              internalDebugLog('Sending Endpoints For Request')
              res.json(endpoints)
            }
            discoveryClient.disconnect(() => {
              internalDebugLog('Get Endpoints Request Disconnect')
            });
          })
        }).catch(function (err: Error) {
          internalDebugLog('Get Endpoints Request Error ' + err.message)
          res.json([])
        })
      }
    } else {
      internalDebugLog('Get Endpoints Request None Node ' + JSON.stringify(req.params))
      res.json([])
    }
  })

  RED.httpAdmin.get('/opcuaIIoT/plain/DataTypeIds', RED.auth.needsPermission('opcuaIIoT.plain.datatypes'), function (req, res) {
    res.json(_.toArray(_.invert(DataTypeIds)))
  })

  RED.httpAdmin.get('/opcuaIIoT/plain/AttributeIds', RED.auth.needsPermission('opcuaIIoT.plain.attributeids'), function (req, res) {
    res.json(_.toArray(_.invert(AttributeIds)))
  })

  RED.httpAdmin.get('/opcuaIIoT/plain/StatusCodes', RED.auth.needsPermission('opcuaIIoT.plain.statuscodes'), function (req, res) {
    res.json(_.toArray(_.invert(StatusCodes)))
  })

  RED.httpAdmin.get('/opcuaIIoT/plain/ObjectTypeIds', RED.auth.needsPermission('opcuaIIoT.plain.objecttypeids'), function (req, res) {
    res.json(ObjectTypeIds)
  })

  RED.httpAdmin.get('/opcuaIIoT/plain/VariableTypeIds', RED.auth.needsPermission('opcuaIIoT.plain.variabletypeids'), function (req, res) {
    res.json(VariableTypeIds)
  })

  RED.httpAdmin.get('/opcuaIIoT/plain/ReferenceTypeIds', RED.auth.needsPermission('opcuaIIoT.plain.referencetypeids'), function (req, res) {
    res.json(ReferenceTypeIds)
  })

  RED.httpAdmin.get('/opcuaIIoT/xmlsets/public', RED.auth.needsPermission('opcuaIIoT.xmlsets'), function (req, res) {
    const xmlset = [
      nodesets.di,
      nodesets.adi,
      'public/vendor/opc-foundation/xml/Opc.ISA95.NodeSet2.xml',
      'public/vendor/opc-foundation/xml/Opc.Ua.Adi.NodeSet2.xml',
      'public/vendor/opc-foundation/xml/Opc.Ua.Di.NodeSet2.xml',
      'public/vendor/opc-foundation/xml/Opc.Ua.Gds.NodeSet2.xml',
      'public/vendor/harting/10_di.xml',
      'public/vendor/harting/20_autoid.xml',
      'public/vendor/harting/30_aim.xml',
    ]
    res.json(xmlset)
  })

  RED.httpAdmin.get('/opcuaIIoT/list/DataTypeIds', RED.auth.needsPermission('opcuaIIoT.list.datatypeids'), function (req, res) {
    const resultTypeList = enumToTypeList(DataTypeIds)
    res.json(resultTypeList)
  })

  RED.httpAdmin.get('/opcuaIIoT/list/EventTypeIds', RED.auth.needsPermission('opcuaIIoT.list.eventtypeids'), function (req, res) {
    const eventTypesResults = enumToTypeList(ObjectTypeIds).filter((item) => {
      return item.label.indexOf('Event') > -1
    })
    res.json(eventTypesResults)
  })

  RED.httpAdmin.get('/opcuaIIoT/list/InstanceTypeIds', RED.auth.needsPermission('opcuaIIoT.list.instancetypeids'), function (req, res) {
    const resultTypeList = [ObjectTypeIds, VariableTypeIds].flatMap((item) => enumToTypeList(item))

    res.json(resultTypeList)
  })

  const enumToTypeList = <O extends object>(inputEnum: O): typeListItem<keyof O>[] => {
    return getEnumKeys(inputEnum).map((key) => {
      return {nodeId: `i=${inputEnum[key]}`, label: key}
    })
  }

  type typeListItem<T> = {
    nodeId: `i=${string}`
    label: T
  }

  RED.httpAdmin.get('/opcuaIIoT/list/VariableTypeIds', RED.auth.needsPermission('opcuaIIoT.list.variabletypeids'), function (req, res) {
    const resultTypeList = enumToTypeList(VariableTypeIds)

    res.json(resultTypeList)
  })

  RED.httpAdmin.get('/opcuaIIoT/list/ReferenceTypeIds', RED.auth.needsPermission('opcuaIIoT.list.referencetypeids'), function (req, res) {
    const resultTypeList = enumToTypeList(ReferenceTypeIds)
    res.json(resultTypeList)
  })

  RED.httpAdmin.get('/opcuaIIoT/list/FilterTypes', RED.auth.needsPermission('opcuaIIoT.list.filterids'), function (req, res) {
    const resultTypeList = [
      {name: 'dataType', label: 'Data Type'},
      {name: 'dataValue', label: 'Data Value'},
      {name: 'nodeClass', label: 'Node Class'},
      {name: 'typeDefinition', label: 'Type Definition'},
      {name: 'browseName', label: 'Browse Name'},
      {name: 'nodeId', label: 'Node Id'},
    ]
    res.json(resultTypeList)
  })
}
