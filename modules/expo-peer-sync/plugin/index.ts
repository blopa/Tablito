import { ConfigPlugin, withAndroidManifest, withInfoPlist } from '@expo/config-plugins';

const withPeerSync: ConfigPlugin<{ iosDiscoveryDescription?: string }> = (
  config,
  { iosDiscoveryDescription } = {}
) => {
  config = withAndroidManifest(config, (config) => {
    const mainApplication = config.modResults.manifest.application?.[0];
    if (mainApplication) {
      // Ensure we have necessary permissions
      if (!config.modResults.manifest['uses-permission']) {
        config.modResults.manifest['uses-permission'] = [];
      }

      const permissions = [
        'android.permission.INTERNET',
        'android.permission.ACCESS_WIFI_STATE',
        'android.permission.CHANGE_WIFI_MULTICAST_STATE',
        'android.permission.NEARBY_WIFI_DEVICES',
      ];

      permissions.forEach((perm) => {
        if (
          !config.modResults.manifest['uses-permission']?.some((p) => p.$['android:name'] === perm)
        ) {
          config.modResults.manifest['uses-permission']?.push({ $: { 'android:name': perm } });
        }
      });
    }
    return config;
  });

  config = withInfoPlist(config, (config) => {
    const infoPlist = config.modResults;
    const bonjourServices = (infoPlist.NSBonjourServices as string[] | undefined) ?? [];
    if (!bonjourServices.includes('_expo-peer-sync._tcp')) {
      bonjourServices.push('_expo-peer-sync._tcp');
    }
    infoPlist.NSBonjourServices = bonjourServices;

    infoPlist.NSLocalNetworkUsageDescription =
      iosDiscoveryDescription ||
      (infoPlist.NSLocalNetworkUsageDescription as string | undefined) ||
      'Allow $(PRODUCT_NAME) to discover and sync with nearby devices.';

    return config;
  });

  return config;
};

export default withPeerSync;
