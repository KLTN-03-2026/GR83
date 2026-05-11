$ErrorActionPreference='Stop'
$base='http://127.0.0.1:4000/api'
$results=New-Object System.Collections.Generic.List[object]
$ctx=@{}

function Invoke-Api {
  param([string]$Method,[string]$Path,[object]$Body=$null)
  $uri="$base$Path"
  try {
    if($null -ne $Body){
      $json=$Body | ConvertTo-Json -Depth 20
      $resp=Invoke-RestMethod -Method $Method -Uri $uri -ContentType 'application/json; charset=utf-8' -Body $json
    } else {
      $resp=Invoke-RestMethod -Method $Method -Uri $uri
    }
    return @{ ok=$true; status=200; body=$resp; error=$null; uri=$uri }
  } catch {
    $status=0; $content=''
    try { $status=[int]$_.Exception.Response.StatusCode } catch {}
    try {
      $stream=$_.Exception.Response.GetResponseStream()
      if($stream){ $reader=New-Object System.IO.StreamReader($stream); $content=$reader.ReadToEnd(); $reader.Close() }
    } catch {}
    $parsed=$null
    if($content){ try { $parsed=$content | ConvertFrom-Json } catch {} }
    return @{ ok=$false; status=$status; body=$parsed; error=$_.Exception.Message; raw=$content; uri=$uri }
  }
}

function Add-Check {
  param([string]$Module,[string]$Step,[hashtable]$Resp,[scriptblock]$Assert,[string]$Expected)
  $pass=$false; $detail=''
  try { $pass = [bool](& $Assert $Resp) } catch { $pass = $false; $detail = $_.Exception.Message }
  if(-not $detail){
    if($Resp.ok){ $detail = [string]$Resp.body.message } else { $detail = if($Resp.body -and $Resp.body.message){[string]$Resp.body.message}else{[string]$Resp.error} }
  }
  $results.Add([pscustomobject]@{ module=$Module; step=$Step; pass=$pass; httpStatus=$Resp.status; expected=$Expected; detail=$detail })
}

# Auth
$resp=Invoke-Api 'POST' '/auth/login' @{ identifier='admin@smartride.local'; password='123' }
Add-Check 'Auth' 'Login admin' $resp { param($r) $r.ok -and $r.body.success -eq $true -and [string]$r.body.user.id -eq 'TK0001' } 'Đăng nhập admin thành công'

$resp=Invoke-Api 'POST' '/auth/login' @{ identifier='hoangthie@smartride.local'; password='123' }
Add-Check 'Auth' 'Login tài xế TK0006' $resp { param($r) $r.ok -and $r.body.success -eq $true -and [string]$r.body.user.id -eq 'TK0006' } 'Đăng nhập tài xế thành công'

$resp=Invoke-Api 'GET' '/auth/profile?accountId=TK0001'
Add-Check 'Auth' 'Lấy profile admin' $resp { param($r) $r.ok -and $r.body.success -eq $true -and [string]$r.body.profile.id -eq 'TK0001' } 'Lấy profile theo accountId'

# Driver application + approve
$stamp=[DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$tempPhone = "0929$($stamp.ToString().Substring($stamp.ToString().Length-6))"
$tempEmail = "driver.app.$stamp@smartride.local"
$tempUser = "driver_app_$stamp"
$createAccountBody=@{ username=$tempUser; fullName='Test Driver Applicant'; email=$tempEmail; phone=$tempPhone; roleCode='Q2'; status='HoatDong'; address='Hai Chau, Da Nang'; gender='Nam' }
$resp=Invoke-Api 'POST' '/auth/accounts' $createAccountBody
Add-Check 'Đăng ký tài xế' 'Tạo account customer tạm' $resp { param($r) $r.ok -and $r.body.success -eq $true -and [string]$r.body.account.id } 'Tạo account mới để nộp hồ sơ'
if($resp.ok -and $resp.body.account.id){ $ctx.tempAccountId = [string]$resp.body.account.id } else { $ctx.tempAccountId='' }

$appBody=@{
  accountId=$ctx.tempAccountId
  identifier=$tempEmail
  fullName='Test Driver Applicant'
  phone=$tempPhone
  email=$tempEmail
  avatar='/uploads/avatars/test-driver-applicant.png'
  address='Hai Chau, Da Nang'
  cccd='209998887777'
  backgroundImage='/uploads/drivers/backgrounds/test-driver-lylich.png'
  identityImages=@{ front='/uploads/drivers/identities/test-driver-id-front.png'; back='/uploads/drivers/identities/test-driver-id-back.png' }
  licenseImages=@{ front='/uploads/drivers/licenses/test-driver-license-front.png'; back='/uploads/drivers/licenses/test-driver-license-back.png' }
  vehicleInfo=@{
    licensePlate='43G-54321'
    vehicleType='car'
    vehicleName='Mazda 3'
    brand='Mazda'
    model='3 AT'
    color='Do'
    year='2022'
    seatCount='4'
    images=@{ front='/uploads/drivers/vehicles/test-driver-car-front.png'; side='/uploads/drivers/vehicles/test-driver-car-side.png'; rear='/uploads/drivers/vehicles/test-driver-car-rear.png' }
  }
  emergencyContact=@{ relationship='Anh'; fullName='Nguyen Van Emergency'; phone='0934444555'; address='Thanh Khe, Da Nang' }
  bank=@{ accountHolder='Test Driver Applicant'; accountNumber='7999888877'; bankName='Vietcombank' }
}
$resp=Invoke-Api 'POST' '/drivers/applications' $appBody
Add-Check 'Đăng ký tài xế' 'Nộp hồ sơ tài xế' $resp { param($r) $r.ok -and $r.body.success -eq $true -and [string]$r.body.driver.id } 'Nộp hồ sơ chờ duyệt thành công'
if($resp.ok -and $resp.body.driver.id){ $ctx.newDriverId=[string]$resp.body.driver.id } else { $ctx.newDriverId='' }

if($ctx.newDriverId){
  $resp=Invoke-Api 'PATCH' "/drivers/$($ctx.newDriverId)/approve"
  Add-Check 'Admin duyệt hồ sơ' 'Duyệt tài xế mới' $resp { param($r) $r.ok -and $r.body.success -eq $true -and [string]$r.body.driver.status -eq 'active' } 'Hồ sơ chuyển active'

  $resp=Invoke-Api 'GET' "/drivers/$($ctx.newDriverId)/profile"
  Add-Check 'Admin duyệt hồ sơ' 'Kiểm tra profile sau duyệt' $resp { param($r) $r.ok -and $r.body.success -eq $true -and [string]$r.body.driver.vehicleInfo.vehicleType -eq 'car' } 'Vehicle info đúng sau duyệt'
} else {
  $results.Add([pscustomobject]@{ module='Admin duyệt hồ sơ'; step='Bỏ qua duyệt vì nộp hồ sơ thất bại'; pass=$false; httpStatus=0; expected='Có newDriverId'; detail='Không tạo được hồ sơ tài xế mới' })
}

# Driver wallet
$driverIdForWallet = if($ctx.newDriverId){$ctx.newDriverId}else{'TK0006'}
$resp=Invoke-Api 'GET' "/drivers/$driverIdForWallet/wallet"
Add-Check 'Ví tài xế' 'Lấy ví tài xế' $resp { param($r) $r.ok -and $r.body.success -eq $true -and [string]$r.body.wallet.driverId -eq $driverIdForWallet } 'Lấy ví thành công'

$resp=Invoke-Api 'POST' "/drivers/$driverIdForWallet/wallet/topup" @{ amount=45000; method='momo'; referenceCode="TOPUP-$stamp" }
Add-Check 'Ví tài xế' 'Nạp ví tài xế' $resp { param($r) $r.ok -and $r.body.success -eq $true -and [int]$r.body.transaction.amount -gt 0 } 'Ghi nhận topup'

$resp=Invoke-Api 'POST' "/drivers/$driverIdForWallet/wallet/transfer" @{ recipientPhone='0901111111'; amount=10000; description='Test transfer driver wallet' }
Add-Check 'Ví tài xế' 'Chuyển tiền ví tài xế' $resp { param($r) $r.ok -and $r.body.success -eq $true -and [int]$r.body.transaction.amount -lt 0 } 'Ghi nhận transfer'

# Customer wallet
$resp=Invoke-Api 'GET' '/customers/TK0101/wallet'
Add-Check 'Ví khách hàng' 'Lấy ví khách hàng' $resp { param($r) $r.ok -and $r.body.success -eq $true -and [string]$r.body.wallet.customerId -eq 'TK0101' } 'Lấy ví customer'

$resp=Invoke-Api 'POST' '/customers/TK0101/wallet/topup' @{ amount=30000; method='momo'; referenceCode="C-TOPUP-$stamp" }
Add-Check 'Ví khách hàng' 'Nạp ví khách hàng' $resp { param($r) $r.ok -and $r.body.success -eq $true -and [int]$r.body.transaction.amount -gt 0 } 'Topup customer'

$resp=Invoke-Api 'POST' '/customers/TK0101/wallet/transfer' @{ recipientPhone='0910000002'; amount=7000; description='Test transfer customer wallet' }
Add-Check 'Ví khách hàng' 'Chuyển tiền ví khách hàng' $resp { param($r) $r.ok -and $r.body.success -eq $true -and [int]$r.body.transaction.amount -lt 0 } 'Transfer customer'

# Ride booking
$searchBody=@{
  vehicle='car'
  scheduleEnabled=$false
  pickup=@{ label='Sân bay Đà Nẵng'; address='Sân bay Đà Nẵng'; position=@{ lat=16.0439; lng=108.1983 } }
  destination=@{ label='Cầu Rồng Đà Nẵng'; address='Cầu Rồng Đà Nẵng'; position=@{ lat=16.0615; lng=108.2277 } }
}
$resp=Invoke-Api 'POST' '/rides/search' $searchBody
Add-Check 'Ride booking' 'Tìm chuyến / báo giá' $resp { param($r) $r.ok -and $r.body.success -eq $true -and $r.body.results.Count -gt 0 } 'Tìm được danh sách xe'
$selectedRideId=''
if($resp.ok -and $resp.body.results.Count -gt 0){ $selectedRideId=[string]$resp.body.results[0].id; $ctx.searchResp=$resp.body }

if($selectedRideId){
  $bookBody=@{
    accountId='TK0101'
    vehicle=$ctx.searchResp.vehicle
    scheduleEnabled=[bool]$ctx.searchResp.scheduleEnabled
    pickup=$ctx.searchResp.pickup
    destination=$ctx.searchResp.destination
    selectedRideId=$selectedRideId
    paymentMethod='cash'
    paymentProvider=''
    customerName='Pham Thi D'
    customerPhone='0910000001'
  }
  $resp=Invoke-Api 'POST' '/rides/book' $bookBody
  Add-Check 'Ride booking' 'Đặt chuyến' $resp { param($r) $r.ok -and $r.body.success -eq $true -and [string]$r.body.booking.bookingCode } 'Tạo booking thành công'
  if($resp.ok -and $resp.body.booking.bookingCode){ $ctx.bookingCode=[string]$resp.body.booking.bookingCode }

  if($ctx.bookingCode){
    $resp=Invoke-Api 'GET' "/rides/$($ctx.bookingCode)/payment-status?accountId=TK0101"
    Add-Check 'Ride booking' 'Kiểm tra trạng thái thanh toán' $resp { param($r) $r.ok -and $r.body.success -eq $true } 'Lấy payment status'
  }
}

# Notifications
$resp=Invoke-Api 'GET' '/notifications?recipient=customer&status=all'
Add-Check 'Notification' 'Danh sách thông báo' $resp { param($r) $r.ok -and $r.body.success -eq $true -and $r.body.notifications.Count -ge 1 } 'Lấy list thông báo'

$sendAt=(Get-Date).AddMinutes(2).ToString('o')
$resp=Invoke-Api 'POST' '/notifications' @{ title="Thong bao test $stamp"; content='Noi dung test thong bao'; recipient='customer'; accountId='TK0101'; sendAt=$sendAt }
Add-Check 'Notification' 'Tạo thông báo' $resp { param($r) $r.ok -and $r.body.success -eq $true -and [int]$r.body.notification.id -gt 0 } 'Tạo thông báo thành công'
$createdNotiId=0
if($resp.ok){ $createdNotiId=[int]$resp.body.notification.id }

if($createdNotiId -gt 0){
  $resp=Invoke-Api 'PUT' "/notifications/$createdNotiId" @{ title="Thong bao test $stamp - updated"; content='Noi dung da cap nhat'; recipient='customer'; accountId='TK0101'; sendAt=(Get-Date).AddMinutes(3).ToString('o'); status='scheduled' }
  Add-Check 'Notification' 'Cập nhật thông báo' $resp { param($r) $r.ok -and $r.body.success -eq $true -and [string]$r.body.notification.title -like '*updated*' } 'Cập nhật thông báo thành công'

  $resp=Invoke-Api 'DELETE' "/notifications/$createdNotiId"
  Add-Check 'Notification' 'Xóa thông báo test' $resp { param($r) $r.ok -and $r.body.success -eq $true } 'Xóa thông báo test thành công'
}

$results | ForEach-Object {
  $mark = if($_.pass){'PASS'} else {'FAIL'}
  "[$mark] $($_.module) | $($_.step) | HTTP $($_.httpStatus) | $($_.detail)"
}
'---SUMMARY---'
$summary=[pscustomobject]@{
  total=$results.Count
  pass=($results | Where-Object {$_.pass}).Count
  fail=($results | Where-Object {-not $_.pass}).Count
  byModule=($results | Group-Object module | ForEach-Object { [pscustomobject]@{ module=$_.Name; pass=($_.Group | Where-Object {$_.pass}).Count; fail=($_.Group | Where-Object {-not $_.pass}).Count; total=$_.Count } })
}
$summary | ConvertTo-Json -Depth 6
