import { registerWebModule, NativeModule } from 'expo';

// ExpoPeerSyncModule is not available on the web platform.
class ExpoPeerSyncModule extends NativeModule {}

export default registerWebModule(ExpoPeerSyncModule, 'ExpoPeerSyncModule');
