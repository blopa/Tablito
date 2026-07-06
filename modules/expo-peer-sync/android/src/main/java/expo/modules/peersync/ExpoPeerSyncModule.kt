package expo.modules.peersync

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
          "host" to serviceInfo.host.hostAddress,
          "port" to serviceInfo.port,
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

    AsyncFunction("startHosting") { name: String, txtRecords: Map<String, String> ->
      val port = transport.startServer()
      nsdHelper.registerService(name, port, txtRecords)
    }

    AsyncFunction("stopHosting") {
      nsdHelper.unregisterService()
      transport.stopServer()
    }

    AsyncFunction("startDiscovery") {
      nsdHelper.discoverServices()
    }

    AsyncFunction("stopDiscovery") {
      nsdHelper.stopDiscovery()
    }

    // The service name addresses peers on iOS (Bonjour); Android connects to
    // the host/port resolved during discovery.
    AsyncFunction("connect") { _: String, host: String, port: Int ->
      return@AsyncFunction transport.connect(host, port)
    }

    AsyncFunction("sendMessage") { connectionId: String, message: String ->
      transport.sendMessage(connectionId, message)
    }

    AsyncFunction("disconnect") { connectionId: String ->
      transport.closeConnection(connectionId)
    }
  }
}
