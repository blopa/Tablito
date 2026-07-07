package expo.modules.peersync

import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.peersync.discovery.NSDHelper
import expo.modules.peersync.transport.TCPTransport

class ExpoPeerSyncModule : Module() {
  private val transport by lazy {
    TCPTransport(
      onMessageReceived = { message, connectionId ->
        sendEvent("messageReceived", mapOf(
          "message" to message,
          "connectionId" to connectionId
        ))
      },
      onConnectionClosed = { connectionId ->
        sendEvent("disconnected", mapOf(
          "connectionId" to connectionId
        ))
      }
    )
  }

  private val nsdHelper by lazy {
    NSDHelper(appContext.reactContext!!,
      onDeviceFound = { serviceInfo ->
        sendEvent("deviceFound", mapOf(
          "name" to serviceInfo.serviceName,
          "attributes" to serviceInfo.attributes.mapValues { String(it.value) }
        ))
      },
      onDeviceLost = { serviceInfo ->
        sendEvent("deviceLost", mapOf(
          "name" to serviceInfo.serviceName
        ))
      }
    )
  }

  override fun definition() = ModuleDefinition {
    Name("ExpoPeerSync")

    Events("deviceFound", "deviceLost", "messageReceived", "disconnected")

    AsyncFunction("startHosting") { name: String, txtRecords: Map<String, String>, promise: Promise ->
      val port = transport.startServer()
      nsdHelper.registerService(name, port, txtRecords) { error ->
        if (error == null) {
          promise.resolve(null)
        } else {
          transport.stopServer()
          promise.reject(CodedException(error))
        }
      }
    }

    AsyncFunction("stopHosting") {
      nsdHelper.unregisterService()
      transport.stopServer()
    }

    AsyncFunction("startDiscovery") { promise: Promise ->
      nsdHelper.discoverServices { error ->
        if (error == null) promise.resolve(null) else promise.reject(CodedException(error))
      }
    }

    AsyncFunction("stopDiscovery") {
      nsdHelper.stopDiscovery()
    }

    AsyncFunction("connect") { name: String ->
      val service = nsdHelper.resolvedService(name)
        ?: throw CodedException("Unknown service '$name'")
      val host = service.host?.hostAddress
        ?: throw CodedException("Service '$name' has no resolved address")
      return@AsyncFunction transport.connect(host, service.port)
    }

    AsyncFunction("sendMessage") { connectionId: String, message: String ->
      transport.sendMessage(connectionId, message)
    }

    AsyncFunction("disconnect") { connectionId: String ->
      transport.closeConnection(connectionId)
    }
  }
}
