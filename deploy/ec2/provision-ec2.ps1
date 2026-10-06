param(
  [string]$Region = "ap-southeast-2",
  [string]$InstanceType = "t3.medium",
  [int]$RootVolumeSizeGiB = 30,
  [string]$KeyName,
  [string]$SecurityGroupName = "safebill-ec2-sg",
  [string]$TagName = "safebill-ec2",
  [string]$InstanceProfileName = ""
)

$ErrorActionPreference = "Stop"

if (-not $KeyName) {
  throw "KeyName is required. Example: .\provision-ec2.ps1 -KeyName safebill-key"
}

$aws = "aws"
$awsCandidate = "C:\Program Files\Amazon\AWSCLIV2\aws.exe"
if (Test-Path $awsCandidate) {
  $aws = $awsCandidate
}

function Invoke-AwsJson {
  param([string[]]$Args)
  $output = & $aws @Args
  if (-not $output) { return $null }
  return $output | ConvertFrom-Json
}

$vpcId = (& $aws ec2 describe-vpcs --region $Region --filters Name=isDefault,Values=true --query "Vpcs[0].VpcId" --output text).Trim()
if (-not $vpcId -or $vpcId -eq "None") {
  throw "No default VPC found in region $Region."
}

$subnetId = (& $aws ec2 describe-subnets --region $Region --filters Name=default-for-az,Values=true Name=vpc-id,Values=$vpcId --query "Subnets[0].SubnetId" --output text).Trim()
if (-not $subnetId -or $subnetId -eq "None") {
  throw "No default subnet found in VPC $vpcId."
}

$existingSg = (& $aws ec2 describe-security-groups --region $Region --filters Name=vpc-id,Values=$vpcId Name=group-name,Values=$SecurityGroupName --query "SecurityGroups[0].GroupId" --output text).Trim()
if (-not $existingSg -or $existingSg -eq "None") {
  $securityGroupId = (& $aws ec2 create-security-group --region $Region --group-name $SecurityGroupName --description "SafeBill EC2 web access" --vpc-id $vpcId --query "GroupId" --output text).Trim()
  & $aws ec2 authorize-security-group-ingress --region $Region --group-id $securityGroupId --ip-permissions `
    IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges="[{CidrIp=0.0.0.0/0,Description='SSH'}]" `
    IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges="[{CidrIp=0.0.0.0/0,Description='HTTP'}]" `
    IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges="[{CidrIp=0.0.0.0/0,Description='HTTPS'}]" | Out-Null
} else {
  $securityGroupId = $existingSg
}

$amiId = (& $aws ssm get-parameter --region $Region --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id --query "Parameter.Value" --output text).Trim()
if (-not $amiId -or $amiId -eq "None") {
  throw "Could not resolve latest Ubuntu AMI in region $Region."
}

$userData = Get-Content (Join-Path $PSScriptRoot "bootstrap-ubuntu.sh") -Raw
$encodedUserData = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($userData))

$runArgs = @(
  "ec2", "run-instances",
  "--region", $Region,
  "--image-id", $amiId,
  "--instance-type", $InstanceType,
  "--key-name", $KeyName,
  "--security-group-ids", $securityGroupId,
  "--subnet-id", $subnetId,
  "--block-device-mappings", "DeviceName=/dev/sda1,Ebs={VolumeSize=$RootVolumeSizeGiB,VolumeType=gp3,DeleteOnTermination=true}",
  "--user-data", $encodedUserData,
  "--tag-specifications", "ResourceType=instance,Tags=[{Key=Name,Value=$TagName}]",
  "--query", "Instances[0].InstanceId",
  "--output", "text"
)

if ($InstanceProfileName) {
  $runArgs += @("--iam-instance-profile", "Name=$InstanceProfileName")
}

$instanceId = (& $aws @runArgs).Trim()
if (-not $instanceId) {
  throw "Failed to launch EC2 instance."
}

& $aws ec2 wait instance-running --region $Region --instance-ids $instanceId

$publicIp = (& $aws ec2 describe-instances --region $Region --instance-ids $instanceId --query "Reservations[0].Instances[0].PublicIpAddress" --output text).Trim()
$publicDns = (& $aws ec2 describe-instances --region $Region --instance-ids $instanceId --query "Reservations[0].Instances[0].PublicDnsName" --output text).Trim()

Write-Host ""
Write-Host "SafeBill EC2 instance created."
Write-Host "InstanceId : $instanceId"
Write-Host "Public IP  : $publicIp"
Write-Host "Public DNS : $publicDns"
Write-Host ""
Write-Host "App link after deploy:"
Write-Host "  http://$publicIp"
Write-Host ""
Write-Host "SSH:"
Write-Host "  ssh -i <path-to-key.pem> ubuntu@$publicIp"
