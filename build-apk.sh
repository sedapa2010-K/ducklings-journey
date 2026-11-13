#!/usr/bin/env bash
# =====================================================================
# Duckling's Journey - 안드로이드 빌드
# 사용법 (Git Bash):
#   bash build-apk.sh            → 테스트용 디버그 APK      dist/DucklingsJourney.apk
#   bash build-apk.sh release    → 플레이 스토어용 서명 AAB  dist/DucklingsJourney.aab
#     버전 올리기:  VERSION_CODE=2 VERSION_NAME=1.1 bash build-apk.sh release
#     (플레이 스토어에 새로 올릴 때마다 VERSION_CODE 를 1씩 올려야 함)
#
# 빌드 도구 위치 (한 번 설치해 둔 것):
#   JDK           C:\Users\leejj\android-build\jdk   (JDK21 폴더가 있으면 그걸 씀: Capacitor 8 은 JDK 21 필요)
#   Android SDK   C:\Users\leejj\android-build\sdk
#   앱 프로젝트    C:\Users\leejj\android-build\ducksway-app   (OneDrive 한글 경로 문제를 피해 영문 경로에서 빌드)
#
# 출시용 서명 키 (저장소에 절대 넣지 말 것 · 잃어버리면 앱 업데이트 불가 → 따로 백업):
#   C:\Users\leejj\android-build\upload-keystore.jks
#   C:\Users\leejj\android-build\keystore.properties   (storeFile / storePassword / keyAlias / keyPassword)
# =====================================================================
set -euo pipefail

MODE="${1:-debug}"
SRC="$(cd "$(dirname "$0")" && pwd)"
TOOLS="/c/Users/leejj/android-build"
APP="$TOOLS/ducksway-app"
if [ -d "$TOOLS/jdk21" ]; then export JAVA_HOME="$TOOLS/jdk21"; else export JAVA_HOME="$TOOLS/jdk"; fi
export ANDROID_HOME="$TOOLS/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$PATH"

if [ "$MODE" = "release" ] && [ ! -f "$TOOLS/keystore.properties" ]; then
  cat <<EOF
❌ 출시용 서명 키가 없어요. 아래를 한 번만 직접 실행해서 만들어 주세요 (비밀번호는 직접 정하고 꼭 기억/보관):

  "$JAVA_HOME/bin/keytool" -genkeypair -v -keystore "$TOOLS/upload-keystore.jks" -alias upload -keyalg RSA -keysize 2048 -validity 10000

그다음 $TOOLS/keystore.properties 파일을 아래 내용으로 만들기:
  storeFile=C:/Users/leejj/android-build/upload-keystore.jks
  storePassword=(정한 비밀번호)
  keyAlias=upload
  keyPassword=(정한 비밀번호)
EOF
  exit 1
fi

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
mkdir -p "$RES/drawable"
cat > "$RES/drawable/splash.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/splash_bg" />
    <item><bitmap android:gravity="center" android:src="@drawable/splash_icon" /></item>
</layer-list>
EOF
printf '<?xml version="1.0" encoding="utf-8"?>\n<resources><color name="splash_bg">#BFE6FF</color></resources>\n' > "$RES/values/splash_colors.xml"
sed -i 's/#FFFFFF/#BFE6FF/' "$RES/values/ic_launcher_background.xml"
# 적응형 아이콘: 뒷면 = 수로 풍경 그림, 앞면 = 헤엄치는 오리
for f in ic_launcher ic_launcher_round; do
  cat > "$RES/mipmap-anydpi-v26/$f.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@mipmap/ic_launcher_background"/>
    <foreground android:drawable="@mipmap/ic_launcher_foreground"/>
</adaptive-icon>
EOF
done
MAN="$APP/android/app/src/main/AndroidManifest.xml"
grep -q 'screenOrientation' "$MAN" || sed -i 's|            android:launchMode="singleTask"|            android:launchMode="singleTask"\n            android:screenOrientation="portrait"|' "$MAN"
# 🇰🇷 한국어 폰에서는 홈 화면 앱 이름을 '오리의모험'으로
mkdir -p "$RES/values-ko"
cat > "$RES/values-ko/strings.xml" <<'EOF'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">오리의모험</string>
    <string name="title_activity_main">오리의모험</string>
</resources>
EOF
# 📱 게임 중 화면 꺼짐 방지: 작은 네이티브 플러그인 (JS 에서 Capacitor.Plugins.KeepAwake.set({ on }))
JAVA="$APP/android/app/src/main/java/com/ducksway/ducklingsjourney"
cat > "$JAVA/KeepAwakePlugin.java" <<'EOF'
package com.ducksway.ducklingsjourney;

import android.view.WindowManager;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "KeepAwake")
public class KeepAwakePlugin extends Plugin {
    @PluginMethod
    public void set(PluginCall call) {
        final boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        });
        call.resolve();
    }
}
EOF
cat > "$JAVA/MainActivity.java" <<'EOF'
package com.ducksway.ducklingsjourney;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(KeepAwakePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
EOF
# 🔒 완전 오프라인 게임이라 인터넷 권한은 뺌
sed -i '/android.permission.INTERNET/d' "$MAN"

# 🔏 출시용 서명 설정 (keystore.properties 가 있을 때만 적용, 한 번만 추가)
GR="$APP/android/app/build.gradle"
if ! grep -q 'ducksway-release-signing' "$GR"; then
  cat >> "$GR" <<'EOF'

// ducksway-release-signing: android-build/keystore.properties 로 출시용 서명 (키는 저장소 밖에 보관)
def ksProps = rootProject.file('../../keystore.properties')
if (ksProps.exists()) {
    def kp = new Properties()
    ksProps.withInputStream { kp.load(it) }
    android.signingConfigs { release { storeFile file(kp['storeFile']); storePassword kp['storePassword']; keyAlias kp['keyAlias']; keyPassword kp['keyPassword'] } }
    android.buildTypes.release.signingConfig android.signingConfigs.release
}
EOF
fi
if [ -n "${VERSION_CODE:-}" ]; then sed -i "s/versionCode [0-9]*/versionCode $VERSION_CODE/" "$GR"; fi
if [ -n "${VERSION_NAME:-}" ]; then sed -i "s/versionName \"[^\"]*\"/versionName \"$VERSION_NAME\"/" "$GR"; fi

echo "4) 빌드 (처음엔 Gradle 내려받느라 몇 분 걸림)"
echo "sdk.dir=C\\:\\\\Users\\\\leejj\\\\android-build\\\\sdk" > android/local.properties
cd android
mkdir -p "$SRC/dist"
if [ "$MODE" = "release" ]; then
  ./gradlew.bat bundleRelease --no-daemon -q
  cp app/build/outputs/bundle/release/app-release.aab "$SRC/dist/DucklingsJourney.aab"
  echo "완료: $SRC/dist/DucklingsJourney.aab  (플레이 콘솔에 올리는 파일)"
else
  ./gradlew.bat assembleDebug --no-daemon -q
  cp app/build/outputs/apk/debug/app-debug.apk "$SRC/dist/DucklingsJourney.apk"
  echo "완료: $SRC/dist/DucklingsJourney.apk  (테스트용, 스토어에는 못 올림)"
fi
grep -E 'versionCode|versionName' app/build.gradle | sed 's/^ */   /'
