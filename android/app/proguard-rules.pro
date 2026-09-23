# 当前应用只有 WebView 容器，无需额外混淆规则；保留 WebView 相关注解即可。
-keepclassmembers class * extends android.webkit.WebViewClient { <methods>; }
