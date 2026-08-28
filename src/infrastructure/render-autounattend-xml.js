import { buildRegistryPolicyArgumentLine } from './build-registry-policy-commands.js';

function escapeXml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

function renderFirstLogonCommands(commands) {
    return commands
        .map((commandLine, index) => `
      <SynchronousCommand wcm:action="add">
        <Order>${index + 1}</Order>
        <CommandLine>${escapeXml(commandLine)}</CommandLine>
        <Description>first-logon command ${index + 1}</Description>
      </SynchronousCommand>`)
        .join('');
}

function renderAutoLogon(unattend) {
    if (!unattend.enableAutoLogon) return '';
    return `
      <AutoLogon>
        <Password>
          <Value>${escapeXml(unattend.adminPassword)}</Value>
          <PlainText>true</PlainText>
        </Password>
        <Enabled>true</Enabled>
        <LogonCount>999</LogonCount>
        <Username>${escapeXml(unattend.adminUsername)}</Username>
      </AutoLogon>`;
}

// Windows Setup сам ходит в интернет за Dynamic Update прямо во время
// установки — то есть образ может «поехать» ещё до того, как система
// впервые загрузится. Выключаем ровно тем же одним флагом.
function renderDynamicUpdate(windowsUpdate) {
    if (!windowsUpdate.disable) return '';
    return `
      <DynamicUpdate>
        <Enable>false</Enable>
        <WillShowUI>Never</WillShowUI>
      </DynamicUpdate>`;
}

// specialize — самый ранний проход, где уже есть реестр установленной
// системы и ещё нет ни OOBE, ни первого входа, ни FirstLogonCommands.
// Политики применяются здесь, чтобы между «система установилась» и «мы
// её настроили» не было окна, в котором Windows Update успевает начать
// собственную работу.
function renderWindowsUpdatePolicyCommands(windowsUpdate) {
    if (!windowsUpdate.disable) return '';
    const commands = windowsUpdate.policyValues
        .map((value, index) => `
      <RunSynchronousCommand wcm:action="add">
        <Order>${index + 1}</Order>
        <Path>reg.exe ${escapeXml(buildRegistryPolicyArgumentLine(value))}</Path>
        <Description>disable Windows Update policy ${escapeXml(value.name)}</Description>
      </RunSynchronousCommand>`)
        .join('');
    return `
    <component name="Microsoft-Windows-Deployment" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
      <RunSynchronous>${commands}
      </RunSynchronous>
    </component>`;
}

// Чистая функция: секции unattend и windowsUpdate из base.json5 → готовый
// XML autounattend.xml. Никаких побочных эффектов, никакого чтения файлов —
// вся сборка образа диска (build-answer-file-image.js) отдельно.
export function renderAutounattendXml({ unattend, windowsUpdate }) {
    return `<?xml version="1.0" encoding="utf-8"?>
<unattend xmlns="urn:schemas-microsoft-com:unattend">
  <settings pass="windowsPE">
    <component name="Microsoft-Windows-International-Core-WinPE" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
      <SetupUILanguage>
        <UILanguage>${escapeXml(unattend.uiLanguage)}</UILanguage>
      </SetupUILanguage>
      <InputLocale>${escapeXml(unattend.inputLocale)}</InputLocale>
      <SystemLocale>${escapeXml(unattend.systemLocale)}</SystemLocale>
      <UILanguage>${escapeXml(unattend.uiLanguage)}</UILanguage>
      <UserLocale>${escapeXml(unattend.userLocale)}</UserLocale>
    </component>
    <component name="Microsoft-Windows-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
      <DiskConfiguration>
        <Disk wcm:action="add">
          <DiskID>0</DiskID>
          <WillWipeDisk>true</WillWipeDisk>
          <CreatePartitions>
            <CreatePartition wcm:action="add">
              <Order>1</Order>
              <Type>EFI</Type>
              <Size>100</Size>
            </CreatePartition>
            <CreatePartition wcm:action="add">
              <Order>2</Order>
              <Type>MSR</Type>
              <Size>16</Size>
            </CreatePartition>
            <CreatePartition wcm:action="add">
              <Order>3</Order>
              <Type>Primary</Type>
              <Extend>true</Extend>
            </CreatePartition>
          </CreatePartitions>
          <ModifyPartitions>
            <ModifyPartition wcm:action="add">
              <Order>1</Order>
              <PartitionID>1</PartitionID>
              <Label>System</Label>
              <Format>FAT32</Format>
            </ModifyPartition>
            <ModifyPartition wcm:action="add">
              <Order>2</Order>
              <PartitionID>2</PartitionID>
            </ModifyPartition>
            <ModifyPartition wcm:action="add">
              <Order>3</Order>
              <PartitionID>3</PartitionID>
              <Label>Windows</Label>
              <Letter>C</Letter>
              <Format>NTFS</Format>
            </ModifyPartition>
          </ModifyPartitions>
        </Disk>
      </DiskConfiguration>
      <ImageInstall>
        <OSImage>
          <InstallFrom>
            <MetaData wcm:action="add">
              <Key>/IMAGE/INDEX</Key>
              <Value>${escapeXml(unattend.imageIndex)}</Value>
            </MetaData>
          </InstallFrom>
          <InstallTo>
            <DiskID>0</DiskID>
            <PartitionID>3</PartitionID>
          </InstallTo>
          <WillShowUI>OnError</WillShowUI>
        </OSImage>
      </ImageInstall>
      <UserData>
        <AcceptEula>true</AcceptEula>
      </UserData>${renderDynamicUpdate(windowsUpdate)}
    </component>
  </settings>
  <settings pass="specialize">
    <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
      <ComputerName>${escapeXml(unattend.computerName)}</ComputerName>
      <TimeZone>${escapeXml(unattend.timezone)}</TimeZone>
    </component>${renderWindowsUpdatePolicyCommands(windowsUpdate)}
  </settings>
  <settings pass="oobeSystem">
    <!-- Проход windowsPE настраивает только сам WinPE. Локаль УСТАНОВЛЕННОЙ
         системы закрепляет именно этот компонент, и он применяется до первого
         входа, то есть до FirstLogonCommands, которые ставят 1С. -->
    <component name="Microsoft-Windows-International-Core" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
      <InputLocale>${escapeXml(unattend.inputLocale)}</InputLocale>
      <SystemLocale>${escapeXml(unattend.systemLocale)}</SystemLocale>
      <UILanguage>${escapeXml(unattend.uiLanguage)}</UILanguage>
      <UserLocale>${escapeXml(unattend.userLocale)}</UserLocale>
    </component>
    <component name="Microsoft-Windows-Shell-Setup" processorArchitecture="amd64" publicKeyToken="31bf3856ad364e35" language="neutral" versionScope="nonSxS" xmlns:wcm="http://schemas.microsoft.com/WMIConfig/2002/State" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
      <OOBE>
        <HideEULAPage>true</HideEULAPage>
        <HideOEMRegistrationScreen>true</HideOEMRegistrationScreen>
        <HideOnlineAccountScreens>true</HideOnlineAccountScreens>
        <HideWirelessSetupInOOBE>true</HideWirelessSetupInOOBE>
        <NetworkLocation>Work</NetworkLocation>
        <ProtectYourPC>3</ProtectYourPC>
        <SkipMachineOOBE>true</SkipMachineOOBE>
        <SkipUserOOBE>true</SkipUserOOBE>
      </OOBE>
      <UserAccounts>
        <LocalAccounts>
          <LocalAccount wcm:action="add">
            <Password>
              <Value>${escapeXml(unattend.adminPassword)}</Value>
              <PlainText>true</PlainText>
            </Password>
            <Group>Administrators</Group>
            <Name>${escapeXml(unattend.adminUsername)}</Name>
          </LocalAccount>
        </LocalAccounts>
      </UserAccounts>${renderAutoLogon(unattend)}
      <FirstLogonCommands>${renderFirstLogonCommands(unattend.firstLogonCommands)}
      </FirstLogonCommands>
    </component>
  </settings>
</unattend>
`;
}
