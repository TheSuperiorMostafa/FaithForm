# kotlinx.serialization keeps its generated serializers through reflection on
# the companion; without these the contract fails to decode in a release build
# and only in a release build, which is the worst possible time to find out.
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.**
-keepclassmembers class io.faithform.faithful.contract.** {
    *** Companion;
}
-keepclasseswithmembers class io.faithform.faithful.contract.** {
    kotlinx.serialization.KSerializer serializer(...);
}
