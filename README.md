<h1>Fenix - Flame Elementium Tracking Tool</h1>

<p>Fenix is a desktop tool for Torchlight Infinite, allowing you to track Flame Elementium (FE) earnings. See real-time inventory value, run hourly sessions, track beacon and compass usage, and more...</p>

<p>This project is not affiliated with or endorsed by XD (XD inc.) in any way.</p>

<i>Disclaimer: Portions of this repository were created or refined using AI-assisted development tools. Cursor was used extensively for script writing. UI/UX design was made by me without the use of AI.</i>

<h2>Setting it up</h2>

1. Open Torchlight, go to the "Other" section, and click "Enable Log".

<b> Note: You will have to enable the log every time you launch the game, as the game does not remember you enabled logs </b>
<br><br>
<img width="800" height="400" alt="Torchlight settings menu with 'enable log' button highlighted" src="https://github.com/user-attachments/assets/7a75b5b8-90b2-4db1-9584-199047a8f80b" />
<br>
2. Download the latest <a href="https://github.com/Syncingoutt/Fenix/releases">Fenix-setup.exe</a><br>
3. Install the application (you may be prompted by Windows Defender as the app is not code-signed)<br>
4. Open the application.<br>
5. You may be required to set up the file path to UE_game.log. By default, this folder is found in<br>
<code>\SteamLibrary\steamapps\common\Torchlight Infinite\UE_game\TorchLight\Saved\Logs</code><br><br>
6. Sort any page of your inventory
<br><br>
<img width="500" height="400" alt="Torchlight inventory UI with 'sort' button highlighted" src="https://github.com/user-attachments/assets/3578bfca-c971-41d7-8d90-b6f7b9570409" /><br>
<i>(Keep in mind that the page has to have at least 1 item, otherwise logs do not update). </i>
<br><br>

<i>NOTE: The app has auto-updating, so you will not be required to re-download the app after installing it. </i>

<details>
  <summary>
    <h2>Features</h2>
  </summary>
<h2>Tracking modes</h2>
<h3>Overview</h3>
See the amount of FE you have earned. There is a button to reset it, but it always tracks your inventory, unlike the "Hourly" mode.<br>
  <img width="1438" height="1033" alt="Total tracking mode showing total FE earnt and the 'reset' button" src="https://github.com/user-attachments/assets/f320b5e3-6901-42bc-8030-6509c50da38f" />
<br>
<h3>Session</h3>
<p>Clears the items that are already in your inventory and instead shows only new drops</p>
  <img width="1439" height="830" alt="Hourly tracking mode with an empty inventory, timer, and Start Hour button" src="https://github.com/user-attachments/assets/87c1507b-dde3-4ed7-8cb9-22ecaa85c52f" />
<h4>Hourly History</h4>
  <p>If you use the Hourly mode for multiple hours, you will be able to see each hour individually</p>
<img width="1463" height="672" alt="image" src="https://github.com/user-attachments/assets/02df0162-9508-41c8-971c-60dfdeb435f2" />
<h4>Track used compasses/beacons</h4>
  <p>Track how many beacons, compasses, or resonances you have used to ensure that profits include spending.</p>
<img width="1412" height="340" alt="image" src="https://github.com/user-attachments/assets/06d57319-bf60-46ac-86c8-483e69f6afb7" />
<h3>Overlay</h3>
<p>Click the button on the top-left side, and a movable and customizable overlay will appear, which you can place anywhere on your screen.</p>
<img width="1439" height="830" alt="image" src="https://github.com/user-attachments/assets/6501ae86-feae-4238-b6d2-bf55fbd0a32f" />
<p>The overlay will show information depending on which mode you opened it in (Overview or Hourly)</p>
  <img width="297" height="412" alt="Hourly mode overlay with pause button" src="https://github.com/user-attachments/assets/a529746b-2283-4728-915b-a26e941aa6ce" />
<p>You can customize the overlay by resizing it, disabling boxes you do not wish to see or even changing the opacity & transparacy of it</p>
  <img width="300" height="527" alt="image" src="https://github.com/user-attachments/assets/68fefa32-d675-4510-9e65-e08ff1666895" />
  <img width="925" height="167" alt="image" src="https://github.com/user-attachments/assets/b1eab3b0-98c7-4614-b685-e6742ddaa261" />

<h3>Map history</h3>
<p>See how much you earn each map</p>
<img width="1426" height="541" alt="image" src="https://github.com/user-attachments/assets/793bf860-af2a-4600-a46e-d25b6fccb6b8" />

<h2>Prices</h2>
A page where you can view all the items and see how the economy is doing.
  - See all items at once, sort by groups or search.
  - Shows **7-day mini graphs** for each item

<img width="1437" height="1067" alt="a market showing all items, a 7-day mini-graph, groups of items" src="https://github.com/user-attachments/assets/358b1eb0-ceaf-4051-b28b-2631184f5f2a" />
<p>You can also see how the price changes over a longer period of time by clicking on it</p>
<img width="1409" height="839" alt="image" src="https://github.com/user-attachments/assets/6b3d3a6e-03c3-4232-91e9-b493c56e5db2" />

<i>inspired by poe.ninja</i>
</details>
<details>
  <summary><h2>FAQ</h2></summary>
  <h2>How does it work?</h2>
  <p>The program works by extracting data from a log file within the game files called UE_game.log, located in</p>
  <code>SteamLibrary\steamapps\common\Torchlight Infinite\UE_game\TorchLight\Saved\Logs.</code><br><br>
  <p>By enabling logging, we can extract updates that happen within the inventory, including price checking, sorting -> returning full inventory, or inventory updates by picking up loot.</p>
  <p>No memory reading or injection is used — all data is extracted from existing log output generated by the game.</p>
  <p>The program was written in TypeScript using Electron for UI, updates, etc...</p>
<summary><h2>Why is SmartScreen detecting this app?</h2></summary>
<p>Windows SmartScreen may show a warning when you first download Fenix because the installer is not code-signed. This is normal for open-source software distributed without a code signing certificate.</p>

<h3>Is it safe?</h3>
<p><strong>Yes, it's safe.</strong> The app is:</p>
<ul>
  <li>Open source - you can review the code on GitHub</li>
  <li>Hosted on GitHub Releases (a trusted source)</li>
  <li>Not signed with a certificate (which costs $100-400/year)</li>
</ul>

<h3>How to install despite the warning:</h3>
<ol>
  <li>When you see the SmartScreen warning, click <strong>"More info"</strong></li>
  <li>Click <strong>"Run anyway"</strong> (this option appears after clicking "More info")</li>
  <li>Proceed with the installation</li>
</ol>

<p><i>Note: After enough users download and run the installer from GitHub, Windows may build reputation for the file and the warning may disappear automatically over time. This typically takes several months with regular downloads.</i></p>
</details>
