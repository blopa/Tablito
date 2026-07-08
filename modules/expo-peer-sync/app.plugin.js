const { AndroidConfig, withAndroidManifest, withInfoPlist } = require('expo/config-plugins');

const SERVICE_TYPE = '_expo-peer-sync._tcp';
const NEARBY_WIFI_DEVICES = 'android.permission.NEARBY_WIFI_DEVICES';

function withNearbyWifiNeverForLocation(config) {
  return withAndroidManifest(config, (config) => {
    const permissions = config.modResults.manifest['uses-permission'] ?? [];
    const nearbyPermission = permissions.find(
      (permission) => permission.$?.['android:name'] === NEARBY_WIFI_DEVICES
    );

    if (nearbyPermission) {
      nearbyPermission.$['android:usesPermissionFlags'] = 'neverForLocation';
    }

    return config;
  });
}

function withPeerSync(config, { iosDiscoveryDescription } = {}) {
  config = AndroidConfig.Permissions.withPermissions(config, [
    'android.permission.INTERNET',
    'android.permission.ACCESS_NETWORK_STATE',
    'android.permission.ACCESS_WIFI_STATE',
    'android.permission.CHANGE_WIFI_MULTICAST_STATE',
    NEARBY_WIFI_DEVICES,
  ]);
  config = withNearbyWifiNeverForLocation(config);

  return withInfoPlist(config, (config) => {
    const infoPlist = config.modResults;
    const bonjourServices = infoPlist.NSBonjourServices ?? [];
    if (!bonjourServices.includes(SERVICE_TYPE)) {
      bonjourServices.push(SERVICE_TYPE);
    }
    infoPlist.NSBonjourServices = bonjourServices;

    infoPlist.NSLocalNetworkUsageDescription =
      iosDiscoveryDescription ||
      infoPlist.NSLocalNetworkUsageDescription ||
      'Allow $(PRODUCT_NAME) to discover and sync with nearby devices.';

    return config;
  });
}

module.exports = withPeerSync;
