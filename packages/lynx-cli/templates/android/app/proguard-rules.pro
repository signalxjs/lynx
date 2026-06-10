-dontwarn com.lynx.**
-keep class com.lynx.** { *; }
-keep class com.primjs.** { *; }

# XElement bundles SmartRefreshLayout (com.scwang.smart.refresh.*), whose
# DesignUtil.checkCoordinatorLayout references
# com.google.android.material.appbar.AppBarLayout — an optional view-system
# integration that is never on the classpath in a Lynx (Compose Material3) app
# and is dead at runtime. Without this, R8 hard-fails :app:minifyReleaseWithR8
# on the missing class. Scoped to the appbar package so unrelated missing-class
# warnings still surface. See #383.
-dontwarn com.google.android.material.appbar.**
