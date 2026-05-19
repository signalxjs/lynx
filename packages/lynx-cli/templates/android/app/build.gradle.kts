plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "{{applicationId}}"
    compileSdk = {{compileSdk}}

    defaultConfig {
        applicationId = "{{applicationId}}"
        minSdk = {{minSdk}}
        targetSdk = {{targetSdk}}
        versionCode = {{versionCode}}
        versionName = "{{versionName}}"

        vectorDrawables {
            useSupportLibrary = true
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            // Default to the debug keystore so `sigx run:android --release`
            // installs on a local device without extra setup. Replace with a
            // real signing config (signingConfigs.getByName("release")) before
            // shipping to the Play Store.
            signingConfig = signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
        jniLibs {
            pickFirsts += setOf(
                "lib/*/libc++_shared.so",
                "lib/*/liblynx.so",
                "lib/*/liblynxtrace.so",
                "**/libnapi.so"
            )
        }
    }
}

dependencies {
    // AndroidX + Compose
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.lifecycle.runtime.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.ui)
    implementation(libs.androidx.ui.graphics)
    implementation(libs.androidx.ui.tooling.preview)
    implementation(libs.androidx.material3)
    debugImplementation(libs.androidx.ui.tooling)

    // Lynx SDK
    implementation("org.lynxsdk.lynx:lynx:3.7.0")
    implementation("org.lynxsdk.lynx:lynx-jssdk:3.7.0")
    implementation("org.lynxsdk.lynx:lynx-trace:3.7.0")
    implementation("org.lynxsdk.lynx:primjs:3.7.0")

    // Lynx Services
    implementation("org.lynxsdk.lynx:lynx-service-image:3.7.0")
    implementation("org.lynxsdk.lynx:lynx-service-log:3.7.0")
    implementation("org.lynxsdk.lynx:lynx-service-http:3.7.0")

    // Lynx XElement (extended components)
    implementation("org.lynxsdk.lynx:xelement:3.7.0")
    implementation("org.lynxsdk.lynx:xelement-input:3.7.0")

    // Image loading (required by Lynx image service)
    implementation("com.facebook.fresco:fresco:2.3.0")
    implementation("com.facebook.fresco:animated-gif:2.3.0")
    implementation("com.facebook.fresco:animated-webp:2.3.0")
    implementation("com.facebook.fresco:webpsupport:2.3.0")
    implementation("com.facebook.fresco:animated-base:2.3.0")

    // HTTP client
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // {{GRADLE_DEPENDENCIES}}

    // {{DEBUG_GRADLE_DEPENDENCIES}}
}
