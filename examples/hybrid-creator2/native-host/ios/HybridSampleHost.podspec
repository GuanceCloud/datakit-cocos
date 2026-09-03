Pod::Spec.new do |s|
  s.name             = 'HybridSampleHost'
  s.version          = '1.0.0'
  s.summary          = 'Native Guance SDK owner for the Cocos Creator 2 Hybrid sample.'
  s.homepage         = 'https://github.com/GuanceCloud/datakit-cocos'
  s.license          = { :type => 'Apache-2.0' }
  s.author           = { 'Guance Cloud' => 'support@guance.com' }
  s.source           = { :path => '.' }
  s.platform         = :ios, '12.0'
  s.source_files     = 'HybridSampleSDK.{h,m}', 'HybridSampleEnvironment.generated.h'
  s.public_header_files = 'HybridSampleSDK.h'
  s.requires_arc     = true
  s.dependency 'GuanceSDK/Agent', '1.6.8-alpha.2'
  s.dependency 'GuanceSDK/FTSessionReplay', '1.6.8-alpha.2'
end
