# Homebridge SmartThings Washer

`homebridge-smartthings-washer`는 SmartThings에 연결된 삼성 세탁기 및 건조기의 **작동 상태와 남은 시간을 HomeKit에서 실시간으로 모니터링**하기 위한 Homebridge 플러그인입니다.

이 플러그인은 원격 제어 기능 없이 **상태 확인**에만 초점을 맞춰, "세탁/건조가 다 되었는지"를 홈 앱, Siri, 자동화 등을 통해 쉽게 확인할 수 있도록 돕습니다.

## 주요 기능 ✨

* **실시간 작동 상태 확인**: 세탁기/건조기가 현재 작동 중인지, 아니면 완료되었는지 홈 앱에서 바로 확인할 수 있습니다.
* **남은 시간 표시**: 세탁/건조 완료까지 남은 시간이 홈 앱에 타이머로 표시됩니다.
* **복합 모델 완벽 지원**: 플렉스워시, 비스포크 AI 콤보 등 `main`과 `sub`/`hca.main` 컴포넌트가 함께 있는 최신 기기의 상태를 통합하여 하나의 액세서리로 완벽하게 모니터링합니다.
* **안정적인 API 통신**: OAuth2 인증과 효율적인 API 요청 관리를 통해 안정적인 상태 업데이트를 보장합니다.
* **HomeKit 자동화 연동**: '세탁 완료 시 조명 켜기' 또는 '건조가 끝나면 알림 받기' 같은 강력한 HomeKit 자동화를 구성할 수 있습니다.

***

## 설치 📦

1.  Homebridge UI의 '플러그인' 탭에서 `homebridge-smartthings-washer`를 검색하여 설치합니다.
2.  또는 터미널에서 아래 명령어를 실행하여 설치합니다.
    ```shell
    npm install -g homebridge-smartthings-washer
    ```

***

## 설정 🔧

플러그인을 사용하려면 SmartThings 개발자 워크스페이스에서 OAuth2 인증 정보를 발급받고, `https` 전용 Redirect URI 정책에 맞춰 리버스 프록시를 설정해야 합니다.

### 1단계: SmartThings 인증 정보 발급 (Client ID/Secret)

1.  [SmartThings Developer Workspace](https://smartthings.developer.samsung.com/workspace)에 접속하여 로그인합니다.
2.  `NEW PROJECT`를 누르고, `Automation for the SmartThings App`을 선택합니다.
3.  프로젝트 이름을 입력하고(예: Homebridge Washer), `REGISTER APP`을 누릅니다.
4.  설정 화면에서 아래 항목들을 설정합니다.
    * **App Info**: `App Display Name`에 원하는 이름을 입력합니다.
    * **Hosting**: `Webhook endpoint`를 선택합니다.
    * **Scopes**: 아래 두 가지 권한을 **반드시** 모두 체크합니다.
        * `r:devices:*` (모든 장치 읽기)
        * `x:devices:*` (모든 장치 제어 - 상태 업데이트에 필요)
5.  **Redirect URIs** 항목은 다음 단계에서 리버스 프록시 설정을 완료한 후 최종 `https` 주소를 입력합니다.
6.  `SAVE` 버튼을 눌러 변경사항을 저장하고, 페이지 상단의 **`Client ID`**와 **`Client Secret`**을 미리 복사해 둡니다.

### 2단계: Redirect URI 설정 (HTTPS 필수 및 리버스 프록시)

SmartThings는 보안 정책상 **`https`로 시작하는 주소만** Redirect URI로 허용합니다. 하지만 Homebridge 플러그인은 내부적으로 `http`를 사용하므로, 외부 `https` 요청을 내부 `http`로 전달해주는 **리버스 프록시(Reverse Proxy)** 설정이 필요합니다.

#### 리버스 프록시 개념

* **외부 주소 (사용자 접속용, `https`):** `https://<나의도메인>:<외부포트>`
* **내부 주소 (플러그인 접속용, `http`):** `http://<홈브릿지IP>:8999`

이 플러그인은 내부적으로 **항상 8999 포트**에서 인증 요청을 기다립니다. 따라서 리버스 프록시의 목적지 포트는 **반드시 `8999`로 지정**해야 합니다.

#### 설정 예시 (Synology NAS 기준)

1.  Synology 제어판 > 로그인 포털 > 고급 > **리버스 프록시**로 이동하여 `생성`을 클릭합니다.
2.  **리버스 프록시 규칙 설정:**
    * **소스 (Source):**
        * 프로토콜: `HTTPS`
        * 호스트 이름: `*` 또는 나의 DDNS 주소 (예: `myhome.myds.me`)
        * 포트: 외부에서 사용할 포트 (예: `9001`)
    * **대상 (Destination):**
        * 프로토콜: `HTTP`
        * 호스트 이름: Homebridge가 설치된 기기의 내부 IP 주소 (예: `192.168.1.10`)
        * 포트: **`8999` (고정)**
3.  설정을 저장합니다. 이제 외부 `https://myhome.myds.me:9001` 로 들어온 요청은 내부 `http://192.168.1.10:8999` 로 전달됩니다.
4.  **다시 1단계의 SmartThings 개발자 설정**으로 돌아가 `Redirect URIs` 항목에 방금 설정한 외부 주소(`https://myhome.myds.me:9001`)를 추가하고 저장합니다.

### 3단계: Homebridge 설정 (`config.json`)

```json
{
  "platform": "SmartThingsWasher",
  "name": "SmartThings Laundry",
  "clientId": "YOUR_CLIENT_ID",
  "clientSecret": "YOUR_CLIENT_SECRET",
  "redirectUri": "[https://myhome.myds.me:9001](https://myhome.myds.me:9001)",
  "devices": [
    {
      "deviceLabel": "세탁기"
    },
    {
      "deviceLabel": "건조기"
    }
  ]
}
```

* `clientId` / `clientSecret`: 1단계에서 발급받은 값을 입력합니다.
* `redirectUri`: 2단계에서 설정한 **리버스 프록시의 외부 `https` 주소**를 정확히 입력합니다.
* `devices`: 연동할 장치의 SmartThings 상의 이름. **띄어쓰기, 대소문자까지 정확하게 일치해야 합니다.**

### 4단계: 최초 실행 및 인증

1.  모든 설정을 마친 후 Homebridge를 재시작합니다.
2.  Homebridge 로그를 확인하면 **인증 URL**이 나타납니다.
3.  해당 URL을 복사하여 웹 브라우저에 붙여넣고, SmartThings 계정으로 로그인하여 권한을 허용합니다.
4.  리버스 프록시를 통해 인증 코드가 플러그인에 전달되고, "인증 성공!" 메시지가 나타나면 창을 닫습니다.
5.  Homebridge를 **다시 한번 재시작**하면 장치가 정상적으로 홈 앱에 추가됩니다.

***

## 사용 예시 💡

이 플러그인을 설치하면, 세탁기/건조기가 홈 앱에서 '밸브' 또는 '스프링클러' 아이콘으로 표시됩니다.

* **작동 중일 때**: 아이콘이 파랗게 활성화되며, 남은 시간이 표시됩니다. (복합 모델의 경우 `main` 또는 `sub` 중 하나라도 작동 시 활성화)
* **작동이 끝났을 때**: 아이콘이 비활성화됩니다.

이 상태 변화를 이용하여 "세탁기(밸브)가 꺼지면"을 트리거로 다양한 자동화를 만들 수 있습니다.
