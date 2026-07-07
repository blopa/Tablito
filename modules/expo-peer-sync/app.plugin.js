const { AndroidConfig, withInfoPlist } = require('expo/config-plugins');

const SERVICE_TYPE = '_expo-peer-sync._tcp';

function withPeerSync(config, { iosDiscoveryDescription } = {}) {
  config = AndroidConfig.Permissions.withPermissions(config, [
    'android.permission.INTERNET',
    'android.permission.ACCESS_WIFI_STATE',
    'android.permission.CHANGE_WIFI_MULTICAST_STATE',
    'android.permission.NEARBY_WIFI_DEVICES',
  ]);

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
