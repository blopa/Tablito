import ExpoModulesCore
import Network

public class ExpoPeerSyncModule: Module {
  private static let serviceType = "_expo-peer-sync._tcp"

  private var listener: NWListener?
  private var browser: NWBrowser?
  private var connections: [String: NWConnection] = [:]
  private var inboundIds: Set<String> = []
  private var buffers: [String: Data] = [:]
  private var nextConnectionId = 0

  // The counter keeps ids unique across reconnects to the same endpoint;
  // otherwise a stale connection's cancel handler could remove its replacement.
  private func makeConnectionId(for endpoint: NWEndpoint) -> String {
    nextConnectionId += 1
    return "\(endpoint)#\(nextConnectionId)"
  }

  public func definition() -> ModuleDefinition {
    Name("ExpoPeerSync")

    Events("deviceFound", "deviceLost", "messageReceived", "disconnected")

    AsyncFunction("startHosting") { (name: String, txtRecords: [String: String], promise: Promise) in
      self.startHosting(name: name, txtRecords: txtRecords, promise: promise)
    }

    AsyncFunction("stopHosting") {
      self.listener?.cancel()
      self.listener = nil
      for connectionId in self.inboundIds {
        self.connections[connectionId]?.cancel()
      }
    }

    AsyncFunction("startDiscovery") {
      self.startDiscovery()
    }

    AsyncFunction("stopDiscovery") {
      self.browser?.cancel()
      self.browser = nil
    }

    AsyncFunction("connect") { (name: String, promise: Promise) in
      self.connect(toServiceNamed: name, promise: promise)
    }

    AsyncFunction("sendMessage") { (connectionId: String, message: String, promise: Promise) in
      guard let connection = self.connections[connectionId] else {
        promise.reject(UnknownConnectionException(connectionId))
        return
      }
      let data = Data((message + "\n").utf8)
      connection.send(content: data, completion: .contentProcessed { error in
        if let error {
          promise.reject(SendFailedException(error.localizedDescription))
        } else {
          promise.resolve()
        }
      })
    }

    AsyncFunction("disconnect") { (connectionId: String) in
      self.connections[connectionId]?.cancel()
    }
  }

  // MARK: - Hosting

  private func startHosting(name: String, txtRecords: [String: String], promise: Promise) {
    self.listener?.cancel()

    let listener: NWListener
    do {
      listener = try NWListener(using: .tcp)
    } catch {
      promise.reject(HostingFailedException(error.localizedDescription))
      return
    }

    listener.service = NWListener.Service(
      name: name,
      type: Self.serviceType,
      txtRecord: Self.encodeTXTRecord(txtRecords)
    )
    listener.newConnectionHandler = { [weak self] connection in
      self?.acceptConnection(connection)
    }

    var settled = false
    listener.stateUpdateHandler = { [weak self] state in
      switch state {
      case .ready:
        if !settled {
          settled = true
          promise.resolve()
        }
      case .failed(let error):
        self?.listener = nil
        if !settled {
          settled = true
          promise.reject(HostingFailedException(error.localizedDescription))
        }
      default:
        break
      }
    }

    self.listener = listener
    listener.start(queue: .main)
  }

  // MARK: - Discovery

  private func startDiscovery() {
    self.browser?.cancel()

    let browser = NWBrowser(for: .bonjourWithTXTRecord(type: Self.serviceType, domain: nil), using: .tcp)
    browser.browseResultsChangedHandler = { [weak self] _, changes in
      for change in changes {
        switch change {
        case .added(let result):
          self?.emitDeviceFound(result)
        case .changed(old: _, new: let result, flags: _):
          self?.emitDeviceFound(result)
        case .removed(let result):
          if case let .service(name, _, _, _) = result.endpoint {
            self?.sendEvent("deviceLost", ["name": name])
          }
        default:
          break
        }
      }
    }
    browser.start(queue: .main)
    self.browser = browser
  }

  private func emitDeviceFound(_ result: NWBrowser.Result) {
    guard case let .service(name, _, _, _) = result.endpoint else {
      return
    }
    var attributes: [String: String] = [:]
    if case let .bonjour(txtRecord) = result.metadata {
      attributes = txtRecord.dictionary
    }
    sendEvent("deviceFound", [
      "name": name,
      "attributes": attributes
    ])
  }

  // MARK: - TCP transport

  private func acceptConnection(_ connection: NWConnection) {
    let connectionId = makeConnectionId(for: connection.endpoint)
    connections[connectionId] = connection
    inboundIds.insert(connectionId)

    connection.stateUpdateHandler = { [weak self] state in
      switch state {
      case .ready:
        self?.receiveMessages(on: connection, connectionId: connectionId)
      case .failed, .cancelled:
        self?.removeConnection(connectionId)
      default:
        break
      }
    }
    connection.start(queue: .main)
  }

  private func connect(toServiceNamed name: String, promise: Promise) {
    let endpoint = NWEndpoint.service(name: name, type: Self.serviceType, domain: "local.", interface: nil)
    let connection = NWConnection(to: endpoint, using: .tcp)
    let connectionId = makeConnectionId(for: endpoint)
    connections[connectionId] = connection

    var settled = false
    connection.stateUpdateHandler = { [weak self] state in
      switch state {
      case .ready:
        if !settled {
          settled = true
          promise.resolve(connectionId)
        }
        self?.receiveMessages(on: connection, connectionId: connectionId)
      case .failed(let error):
        if !settled {
          settled = true
          promise.reject(ConnectionFailedException(error.localizedDescription))
        }
        self?.removeConnection(connectionId)
        connection.cancel()
      case .cancelled:
        if !settled {
          settled = true
          promise.reject(ConnectionFailedException("Connection cancelled"))
        }
        self?.removeConnection(connectionId)
      default:
        break
      }
    }
    connection.start(queue: .main)
  }

  private func removeConnection(_ connectionId: String) {
    guard connections.removeValue(forKey: connectionId) != nil else {
      return
    }
    inboundIds.remove(connectionId)
    buffers.removeValue(forKey: connectionId)
    sendEvent("disconnected", ["connectionId": connectionId])
  }

  private func receiveMessages(on connection: NWConnection, connectionId: String) {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, isComplete, error in
      if let data, !data.isEmpty {
        self?.processData(data, connectionId: connectionId)
      }
      if isComplete {
        connection.cancel()
      } else if error == nil {
        self?.receiveMessages(on: connection, connectionId: connectionId)
      }
    }
  }

  private func processData(_ data: Data, connectionId: String) {
    var currentBuffer = buffers[connectionId] ?? Data()
    currentBuffer.append(data)

    while let newlineIndex = currentBuffer.firstIndex(of: 0x0A) { // '\n'
      let lineData = currentBuffer.prefix(upTo: newlineIndex)
      if let message = String(data: lineData, encoding: .utf8) {
        sendEvent("messageReceived", [
          "message": message,
          "connectionId": connectionId
        ])
      }
      currentBuffer.removeSubrange(...newlineIndex)
    }
    buffers[connectionId] = currentBuffer
  }

  // RFC 6763 §6: a TXT record is a sequence of length-prefixed "key=value" entries.
  private static func encodeTXTRecord(_ records: [String: String]) -> Data {
    var data = Data()
    for (key, value) in records {
      let entry = Data("\(key)=\(value)".utf8.prefix(255))
      data.append(UInt8(entry.count))
      data.append(entry)
    }
    return data
  }
}

internal final class HostingFailedException: GenericException<String> {
  override var reason: String { "Failed to start hosting: \(param)" }
}

internal final class ConnectionFailedException: GenericException<String> {
  override var reason: String { "Failed to connect: \(param)" }
}

internal final class UnknownConnectionException: GenericException<String> {
  override var reason: String { "No open connection with id '\(param)'" }
}

internal final class SendFailedException: GenericException<String> {
  override var reason: String { "Failed to send message: \(param)" }
}
