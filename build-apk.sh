#!/usr/bin/env bash
# =====================================================================
# Duckling's Journey - 안드로이드 APK 만들기
# 사용법 (Git Bash):  bash build-apk.sh
# 결과: dist/DucklingsJourney.apk
#
# 빌드 도구 위치 (한 번 설치해 둔 것):
#   JDK 17        C:\Users\leejj\android-build\jdk
#   Android SDK   C:\Users\leejj\android-build\sdk
#   앱 프로젝트    C:\Users\leejj\android-build\ducksway-app   (OneDrive 한글 경로 문제를 피해 영문 경로에서 빌드)
# =====================================================================
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
TOOLS="/c/Users/leejj/android-build"
APP="$TOOLS/ducksway-app"
export JAVA_HOME="$TOOLS/jdk"
export ANDROID_HOME="$TOOLS/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$PATH"

echo "1) 게임 파일을 앱 프로젝트로 복사"
rm -rf "$APP/www" && mkdir -p "$APP/www"
cp "$SRC/index.html" "$APP/www/"
cp -r "$SRC/css" "$SRC/js" "$SRC/fonts" "$APP/www/"

cd "$APP"
if [ ! -d android ]; then
  echo "2) 안드로이드 프로젝트 처음 만들기"
  npx cap add android
fi
echo "3) 앱 프로젝트에 반영 (cap sync) + 아이콘·시작 화면·세로 고정"
npx cap sync android
RES="$APP/android/app/src/main/res"
node "$SRC/tools/make-icons.js" "$RES"
find "$RES" -name "splash.png" -delete
cat > "$RES/drawable/splash.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/splash_bg" />
    <item><bitmap android:gravity="center" android:src="@drawable/splash_icon" /></item>
</layer-list>
EOF
printf '<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="splash_bg">#BFE6FF</color></resources>\n' > "$RES/values/splash_colors.xml"
sed -i 's/#FFFFFF/#BFE6FF/' "$RES/values/ic_launcher_background.xml"
MAN="$APP/android/app/src/main/AndroidManifest.xml"
grep -q 'screenOrientation' "$MAN" || sed -i 's|            android:launchMode="singleTask"|            android:launchMode="singleTask"\n            android:screenOrientation="portrait"|' "$MAN"

echo "4) APK 빌드 (처음엔 Gradle 내려받느라 몇 분 걸림)"
echo "sdk.dir=C\\:\\\\Users\\\\leejj\\\\android-build\\\\sdk" > android/local.properties
cd android
./gradlew.bat assembleDebug --no-daemon -q

mkdir -p "$SRC/dist"
cp app/build/outputs/apk/debug/app-debug.apk "$SRC/dist/DucklingsJourney.apk"
echo "완료: $SRC/dist/DucklingsJourney.apk"
