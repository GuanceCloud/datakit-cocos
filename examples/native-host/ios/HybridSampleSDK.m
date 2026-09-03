#import "HybridSampleSDK.h"
#import "HybridSampleEnvironment.generated.h"

#import <GuanceSDK/GuanceSDK.h>
#import <GuanceSDK/GuanceSessionReplay.h>

@implementation HybridSampleSDK

+ (void)start {
    NSCAssert(FTHybridSampleIOSRumAppID.length > 0,
              @"Set SAMPLE_IOS_APP_ID before building the iOS sample");

    FTSDKConfig *sdkConfig;
    if (FTHybridSampleDatakitURL.length > 0) {
        sdkConfig = [[FTSDKConfig alloc] initWithDatakitUrl:FTHybridSampleDatakitURL];
    } else {
        sdkConfig = [[FTSDKConfig alloc] initWithDatawayUrl:FTHybridSampleDatawayURL
                                               clientToken:FTHybridSampleClientToken];
    }
    sdkConfig.enableSDKDebugLog = FTHybridSampleDebug;
    sdkConfig.service = FTHybridSampleServiceName;
    sdkConfig.env = FTHybridSampleEnv;
    sdkConfig.globalContext = @{ @"sample_name": @"diagnostic-game" };
    [FTMobileAgent startWithConfigOptions:sdkConfig];

    FTRumConfig *rumConfig = [[FTRumConfig alloc] initWithAppid:FTHybridSampleIOSRumAppID];
    rumConfig.sampleRate = 100;
    rumConfig.sessionOnErrorSampleRate = 100;
    rumConfig.enableTraceUserAction = YES;
    rumConfig.enableTraceUserView = YES;
    rumConfig.enableTraceUserResource = YES;
    rumConfig.enableTrackAppCrash = YES;
    [rumConfig setEnableTrackAppFreeze:YES freezeDurationMs:100];
    [[FTMobileAgent sharedInstance] startRumWithConfigOptions:rumConfig];

    FTLoggerConfig *loggerConfig = [[FTLoggerConfig alloc] init];
    loggerConfig.sampleRate = 100;
    loggerConfig.enableCustomLog = YES;
    loggerConfig.enableLinkRumData = YES;
    loggerConfig.printCustomLogToConsole = YES;
    [[FTMobileAgent sharedInstance] startLoggerWithConfigOptions:loggerConfig];

    FTTraceConfig *traceConfig = [[FTTraceConfig alloc] init];
    traceConfig.sampleRate = 100;
    traceConfig.networkTraceType = FTNetworkTraceTypeDDtrace;
    traceConfig.enableLinkRumData = YES;
    [[FTMobileAgent sharedInstance] startTraceWithConfigOptions:traceConfig];

    // Keep native recording enabled by default. enterCocos()/leaveCocos() switch
    // recorder ownership between native UI and the Cocos canvas at runtime.
    FTSessionReplayConfig *replayConfig = [[FTSessionReplayConfig alloc] init];
    replayConfig.sampleRate = 100;
    replayConfig.sessionReplayOnErrorSampleRate = 100;
    replayConfig.touchPrivacy = FTTouchPrivacyLevelShow;
    replayConfig.textAndInputPrivacy = FTTextAndInputPrivacyLevelMaskSensitiveInputs;
    replayConfig.imagePrivacy = FTImagePrivacyLevelMaskNone;
    [[FTRumSessionReplay sharedInstance] startWithSessionReplayConfig:replayConfig];
}

@end
