package expo.modules.peersync.transport

import android.util.Log
import java.io.BufferedReader
import java.io.IOException
import java.io.InputStreamReader
import java.io.PrintWriter
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import kotlin.concurrent.thread

class TCPTransport(
    private val onMessageReceived: (String, String) -> Unit,
    private val onConnectionClosed: (String) -> Unit
) {
    private var serverSocket: ServerSocket? = null
    private val connections = ConcurrentHashMap<String, Socket>()
    private val writers = ConcurrentHashMap<String, PrintWriter>()
    private val inboundIds = ConcurrentHashMap.newKeySet<String>()
    private val nextConnectionId = AtomicLong()

    fun startServer(): Int {
        val server = ServerSocket(0)
        serverSocket = server
        thread {
            while (!server.isClosed) {
                try {
                    handleSocket(server.accept(), inbound = true)
                } catch (e: Exception) {
                    if (!server.isClosed) Log.e(TAG, "Error accepting connection", e)
                }
            }
        }
        return server.localPort
    }

    fun stopServer() {
        serverSocket?.let { runCatching { it.close() } }
        serverSocket = null
        inboundIds.toList().forEach { closeConnection(it) }
    }

    fun connect(host: String, port: Int): String {
        val socket = Socket()
        socket.connect(InetSocketAddress(host, port), CONNECT_TIMEOUT_MS)
        return handleSocket(socket, inbound = false)
    }

    fun sendMessage(connectionId: String, message: String) {
        val writer = writers[connectionId]
            ?: throw IllegalStateException("No open connection with id $connectionId")
        writer.println(message)
        if (writer.checkError()) throw IOException("Failed to send message to $connectionId")
    }

    fun closeConnection(connectionId: String) {
        val socket = connections.remove(connectionId) ?: return
        inboundIds.remove(connectionId)
        writers.remove(connectionId)
        runCatching { socket.close() }
        onConnectionClosed(connectionId)
    }

    private fun handleSocket(socket: Socket, inbound: Boolean): String {
        // The counter keeps ids unique across reconnects to the same host/port;
        // otherwise a lingering reader thread's cleanup could tear down the
        // replacement connection.
        val connectionId =
            "${socket.inetAddress.hostAddress}:${socket.port}#${nextConnectionId.incrementAndGet()}"
        connections[connectionId] = socket
        writers[connectionId] = PrintWriter(socket.getOutputStream(), true)
        if (inbound) inboundIds.add(connectionId)

        thread {
            try {
                val reader = BufferedReader(InputStreamReader(socket.getInputStream()))
                while (true) {
                    val message = reader.readLine() ?: break
                    onMessageReceived(message, connectionId)
                }
            } catch (e: Exception) {
                if (!socket.isClosed) Log.e(TAG, "Error reading from $connectionId", e)
            } finally {
                closeConnection(connectionId)
            }
        }
        return connectionId
    }

    companion object {
        private const val TAG = "TCPTransport"
        private const val CONNECT_TIMEOUT_MS = 10_000
    }
}
