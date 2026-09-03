#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/** Native SDK owner for the Cocos Hybrid sample. */
@interface HybridSampleSDK : NSObject

/** Call before Cocos starts JavaScript. */
+ (void)start;

/** Presents the native sample page over the Cocos view controller. */
+ (void)showNativePage;

/** Dismisses the native page so Cocos can claim RUM View and Replay ownership. */
+ (void)showCocosPage;

/** Read by Cocos before entering or re-entering its Hybrid lifecycle. */
+ (BOOL)isNativePageVisible;

/** Returns an optional generated local benchmark bootstrap. */
+ (NSString *)replayTrafficBenchmarkConfig;

/** Adds the unique benchmark run markers before the Cocos View starts. */
+ (void)prepareReplayTrafficBenchmark:(NSString *)json;

/** Requests an immediate native SDK flush after Cocos Replay stops. */
+ (void)flushReplayTrafficBenchmark;

@end

NS_ASSUME_NONNULL_END
