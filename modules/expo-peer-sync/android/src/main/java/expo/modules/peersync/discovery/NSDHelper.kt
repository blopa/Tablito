package expo.modules.peersync.discovery

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.util.Log
import java.util.concurrent.ConcurrentHashMap

class NSDHelper(
    context: Context,
    private val onDeviceFound: (NsdServiceInfo) -> Unit,
    private val onDeviceLost: (NsdServiceInfo) -> Unit
) {
    private val nsdManager = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    private var registrationListener: NsdManager.RegistrationListener? = null
    private var discoveryListener: NsdManager.DiscoveryListener? = null
    private val resolvedServices = ConcurrentHashMap<String, NsdServiceInfo>()

    /** The resolved address of a discovered service, if we have seen it. */
    fun resolvedService(name: String): NsdServiceInfo? = resolvedServices[name]

    fun registerService(
        name: String,
        port: Int,
        txtRecords: Map<String, String>,
        onResult: (error: String?) -> Unit
    ) {
        // NsdManager rejects a listener that is already registered.
        unregisterService()

        val serviceInfo = NsdServiceInfo().apply {
            serviceName = name
            serviceType = SERVICE_TYPE
            setPort(port)
            txtRecords.forEach { (key, value) ->
                setAttribute(key, value)
            }
        }

        registrationListener = object : NsdManager.RegistrationListener {
            private var settled = false

            override fun onServiceRegistered(serviceInfo: NsdServiceInfo) {
                Log.d(TAG, "Service registered: ${serviceInfo.serviceName}")
                if (!settled) {
                    settled = true
                    onResult(null)
                }
            }

            override fun onRegistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                Log.e(TAG, "Registration failed: $errorCode")
                if (registrationListener == this) registrationListener = null
                if (!settled) {
                    settled = true
                    onResult("NSD registration failed with error code $errorCode")
                }
            }

            override fun onServiceUnregistered(serviceInfo: NsdServiceInfo) {
                Log.d(TAG, "Service unregistered")
            }

            override fun onUnregistrationFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                Log.e(TAG, "Unregistration failed: $errorCode")
            }
        }

        nsdManager.registerService(serviceInfo, NsdManager.PROTOCOL_DNS_SD, registrationListener)
    }

    fun discoverServices(onResult: (error: String?) -> Unit) {
        // NsdManager throws if discovery is started twice with the same listener.
        if (discoveryListener != null) {
            onResult(null)
            return
        }

        discoveryListener = object : NsdManager.DiscoveryListener {
            private var settled = false

            override fun onDiscoveryStarted(regType: String) {
                Log.d(TAG, "Service discovery started")
                if (!settled) {
                    settled = true
                    onResult(null)
                }
            }

            override fun onServiceFound(service: NsdServiceInfo) {
                Log.d(TAG, "Service found: ${service.serviceName}")
                if (service.serviceType == SERVICE_TYPE) {
                    nsdManager.resolveService(service, object : NsdManager.ResolveListener {
                        override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                            Log.e(TAG, "Resolve failed: $errorCode")
                        }

                        override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                            Log.d(TAG, "Service resolved: ${serviceInfo.serviceName}")
                            resolvedServices[serviceInfo.serviceName] = serviceInfo
                            onDeviceFound(serviceInfo)
                        }
                    })
                }
            }

            override fun onServiceLost(service: NsdServiceInfo) {
                Log.d(TAG, "Service lost: ${service.serviceName}")
                resolvedServices.remove(service.serviceName)
                onDeviceLost(service)
            }

            override fun onDiscoveryStopped(serviceType: String) {
                Log.i(TAG, "Discovery stopped: $serviceType")
            }

            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.e(TAG, "Discovery failed: Error code:$errorCode")
                if (discoveryListener == this) discoveryListener = null
                if (!settled) {
                    settled = true
                    onResult("NSD discovery failed with error code $errorCode")
                }
            }

            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.e(TAG, "Stop discovery failed: Error code:$errorCode")
                nsdManager.stopServiceDiscovery(this)
            }
        }

        nsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, discoveryListener)
    }

    fun stopDiscovery() {
        discoveryListener?.let {
            nsdManager.stopServiceDiscovery(it)
            discoveryListener = null
        }
    }

    fun unregisterService() {
        registrationListener?.let {
            nsdManager.unregisterService(it)
            registrationListener = null
        }
    }

    companion object {
        private const val TAG = "NSDHelper"
        private const val SERVICE_TYPE = "_expo-peer-sync._tcp."
    }
}
