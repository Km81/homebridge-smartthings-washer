# Homebridge SmartThings Washer

`homebridge-smartthings-washer`는 SmartThings에 연결된 삼성 세탁기 및 건조기의 **작동 상태와 남은 시간을 HomeKit에서 실시간으로 모니터링**하기 위한 Homebridge 플러그인입니다.

이 플러그인은 원격 제어 기능 없이 **상태 확인**에만 초점을 맞춰, "세탁/건조가 다 되었는지"를 홈 앱, Siri, 자동화 등을 통해 쉽게 확인할 수 있도록 돕습니다.

## 주요 기능

* **실시간 작동 상태 확인**: 세탁기/건조기가 현재 작동 중인지, 아니면 완료되었는지 홈 앱에서 바로 확인할 수 있습니다.
* **남은 시간 표시**: 세탁/건조 완료까지 남은 시간이 홈 앱에 타이머로 표시됩니다.
* **다중 장치 지원**: 여러 대의 세탁기와 건조기를 한 번에 등록하여 모니터링할 수 있습니다.
* **안정적인 API 통신**: SmartThings API 요청을 효율적으로 관리하여 안정적인 상태 업데이트를 보장합니다.
* **HomeKit 자동화 연동**: '세탁 완료 시 조명 켜기' 또는 '건조가 끝나면 알림 받기' 같은 강력한 HomeKit 자동화를 구성할 수 있습니다.

## 설치

1.  Homebridge UI의 '플러그인' 탭에서 `homebridge-smartthings-washer`를 검색하여 설치합니다.
2.  또는 터미널에서 아래 명령어를 실행하여 설치합니다.
    ```shell
    npm install -g homebridge-smartthings-washer
    ```

## 설정

Homebridge UI의 GUI 설정을 이용하거나, `config.json` 파일을 직접 수정하여 플랫폼을 추가합니다.

```json
{
  "platform": "SmartThingsWasher",
  "name": "SmartThings Laundry",
  "token": "YOUR_SMARTTHINGS_PERSONAL_ACCESS_TOKEN",
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

* `platform`: **"SmartThingsWasher"** (고정값)
* `name`: Homebridge 로그에 표시될 플랫폼 이름 (예: "SmartThings Laundry")
* `token`: [SmartThings 개발자 페이지](https://account.smartthings.com/tokens)에서 발급받은 개인용 액세스 토큰. **반드시 `l:devices`, `r:devices:*` 권한이 모두 포함되어야 합니다.**
* `devices`: 연동할 장치 목록 (배열).
    * `deviceLabel`: 연동할 장치의 SmartThings 상의 이름. **띄어쓰기까지 정확하게 일치해야 합니다.**

## 사용 예시

이 플러그인을 설치하면, 세탁기/건조기가 홈 앱에서 '밸브' 또는 '스프링클러' 아이콘으로 표시됩니다.
* **작동 중일 때**: 아이콘이 파랗게 활성화되며, 남은 시간이 표시됩니다.
* **작동이 끝났을 때**: 아이콘이 비활성화됩니다.

이 상태 변화를 이용하여 "세탁기(밸브)가 꺼지면"을 트리거로 다양한 자동화를 만들 수 있습니다.
