import java.util.Properties

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.google.services)
}

// Release signing: android/keystore.properties (gitignored, you create it, see keystore.properties.example)
val keystoreProps = Properties().apply {
    val f = rootProject.file("keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "com.evaakselrad.shelly"
    compileSdk {
        version = release(36) {
            minorApiLevel = 1
        }
    }

    defaultConfig {
        applicationId = "com.evaakselrad.shelly"
        minSdk = 26
        targetSdk = 36
        // Bump versionCode on every release: the self-updater compares it.
        versionCode = 5
        versionName = "2.0.1"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "SITE_URL", "\"https://shelly.evaakselrad.com\"")
    }

    buildFeatures {
        buildConfig = true
    }

    signingConfigs {
        // keystore.properties, or the SHELLY_* environment variables that scripts/android-release.mjs sets
        val storeFile = System.getenv("SHELLY_KEYSTORE") ?: keystoreProps.getProperty("storeFile")
        if (storeFile != null) {
            create("release") {
                this.storeFile = file(storeFile)
                storePassword = System.getenv("SHELLY_STORE_PASSWORD") ?: keystoreProps.getProperty("storePassword")
                keyAlias = System.getenv("SHELLY_KEY_ALIAS") ?: keystoreProps.getProperty("keyAlias", "shelly")
                keyPassword = System.getenv("SHELLY_KEY_PASSWORD") ?: keystoreProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            signingConfigs.findByName("release")?.let { signingConfig = it }
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.appcompat)
    implementation(libs.material)
    implementation(libs.androidx.activity)
    implementation(libs.androidx.work.runtime)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.messaging)
    implementation(libs.play.services.location)
    testImplementation(libs.junit)
    testImplementation("org.json:json:20240303")
    androidTestImplementation(libs.androidx.junit)
    androidTestImplementation(libs.androidx.espresso.core)
}
