# R8 rules for the release build.
#
# Release runs R8 in full mode (the AGP 8 default) with resource shrinking. Most
# of what FaithForm links against ships its own consumer rules inside the AAR or
# JAR, and those are applied automatically: OkHttp, Stripe's payment sheet,
# Media3, CameraX, Play services location, AndroidX and kotlinx.serialization's
# core rules. Nothing below repeats them. What is here is what only this app can
# know: which of its own classes are reached reflectively.
#
# The mapping file is kept. AGP writes it to
# app/build/outputs/mapping/release/mapping.txt and embeds it in the App Bundle
# (BUNDLE-METADATA/com.android.tools.build.obfuscation/proguard.map), so Play
# Console deobfuscates crash and ANR stack traces for each release without a
# separate upload.

# ---------------------------------------------------------------------------
# kotlinx.serialization
# ---------------------------------------------------------------------------
#
# Every wire type in FaithForm is @Serializable: the generated contract, the
# envelope, the session record, and a number of small private request/reply
# types declared next to the call that uses them. Explicit `X.serializer()`
# calls are ordinary references R8 can follow, but a reified `serializer<T>()`
# (used for generic envelopes such as MobileSuccess<AttendanceResult>) finds
# the serializer through the class's companion at runtime. Without these the
# contract decodes in a debug build and fails only in a release build — the
# worst possible place to find out.
-keepattributes *Annotation*, InnerClasses, Signature, EnclosingMethod
-dontnote kotlinx.serialization.**

# kotlinx.serialization's own consumer rules (bundled in the core JAR under
# META-INF/com.android.tools/r8) already keep the `Companion` field and the
# `serializer()` method of every @Serializable class. The two rules below are
# FaithForm's belt to that library's braces, scoped to FaithForm's own
# packages: if a future library version narrows its rules, the contract still
# decodes. They previously covered only `io.faithform.app.contract`, while
# wire types also live in `network`, `session`, `ui` and the feature modules.
-keepclassmembers @kotlinx.serialization.Serializable class io.faithform.app.** {
    *** Companion;
}
-keepclasseswithmembers class io.faithform.app.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# Enum wire names are read from @SerialName on each constant.
-keepclassmembers @kotlinx.serialization.Serializable enum io.faithform.app.** {
    <fields>;
}

# ---------------------------------------------------------------------------
# Android framework entry points that are named, not referenced
# ---------------------------------------------------------------------------
#
# The Application and Activity are kept by AAPT's generated rules from the
# manifest. The geofence receivers are not registered in v1 and are therefore
# free to be removed from the release APK, which is correct: a component
# nothing can start is dead code.
