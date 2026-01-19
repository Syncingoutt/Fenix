<h1>Fenix - Flame Elementium Tracking Tool</h1>

<p>Torchlight Infinite tracking app for real-time FE per hour and inventory updates.</p>

<p>This project is not affiliated with or endorsed by XD (XD inc.) in any way.</p>

<p><b>This project does not use the Chinese FE tracker DB; Meaning that some items might be missing (JSON file is over 300+). I have not added organs from Vorax, but all other items have been added.</b></p>

<i>Disclaimer: Portions of this repository were created or refined using AI-assisted development tools. Cursor was used extensively for script writing. UI/UX design was made by me without the use of AI.</i>

<h2>Setting it up</h2>
1. Open Torchlight, go to the "Other" section, and click "Enable Log".
<br><br>
<img width="1000" height="800" alt="Torchlight settings menu with 'enable log' button highlighted" src="https://github.com/user-attachments/assets/7a75b5b8-90b2-4db1-9584-199047a8f80b" />
<br><br>
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
<h3>Total</h3>
See the amount of FE you have earned. There is a button to reset it, but it always tracks your inventory, unlike the "Hourly" mode.<br>
<img width="800" height="700" alt="Total tracking mode showing total FE earned and the 'reset' button" src="https://github.com/user-attachments/assets/820b3ed2-256d-4696-8b20-12424d6ffcb3" />
<br>
<h3>Hourly</h3>
<p>Clears the items that are already in your inventory and instead shows only new drops</p>
<img width="800" height="700" alt="Hourly tracking mode with an empty inventory, timer, and Start Hour button" src="https://github.com/user-attachments/assets/2eefc29b-0333-43ba-9d39-d714ea3cc441" />
<h4>Hourly sessions</h4>
  <p>If you use the Hourly mode for multiple hours, you will be able to see each hour individually</p>
    <img width="500" height="400" alt="Hourly sessions popup showing multiple tracked hours listed separately" src="https://github.com/user-attachments/assets/56b72405-b06e-4e4e-8a11-590d6813f143" />
<h4>Track used compasses/beacons</h4>
  <p>Track how many beacons, compasses, or resonances you have used to ensure that profits include spending.</p>
  <img width="341" height="420" alt="Hourly mode interface for selecting compasses, beacons to track as used" src="https://github.com/user-attachments/assets/852d78e2-a6ee-4179-9651-ff9bc00c3b61" />
<br>
  <img width="710" height="266" alt="Hourly calculation showing used compasses and beacons subtracting from total value" src="https://github.com/user-attachments/assets/e55c9369-6d51-4fa0-bb8e-21ccb8cba89f" />
  <p>Keep in mind that this is not a way to check how many beacons/compasses/resonances you use, but instead to see how much to subtract from the total value, meaning that if you select Voidlands and use 5 of those compasses, it will be -5, but then drop 2 it will be -3</p>
  <i>It also supports restocking mid-way, meaning that if you purchase compasses or beacons mid-way into the session, it will not inflate/deflate the profit</i><br>
<h2>Inventory</h2>
<p>See all the items that you have obtained or have already obtained based on the mode you have selected</p>
<img width="800" height="700" alt="Inventory view showing collected items based on the selected tracking mode" src="https://github.com/user-attachments/assets/e8743635-0b79-4b31-91c1-62393512d1be" />
<br>
<h3>Automatic price updating</h3>
<p>When you price check an item, it will automatically reflect in the app.</p>
<p><i>Note: I do have plans to make a database so that when any user price checks the item, if it's a recent price check, it sends that data syncing up with other users, but currently this works locally.</i></p><br>
<h3>Breakdown</h3>
<p>Here you can see a breakdown of all the items you have collected and the price of that group</p>
<img width="256" height="440" alt="Inventory breakdown showing item groups and the total value for each group" src="https://github.com/user-attachments/assets/1ab4977b-b4e8-4c86-ab45-5ea8d5a679d3" /><br>
<i>To filter by group, simply click on any of the groups, and it will only show items from that group.</i>
<h3>Tax</h3>
<p>By going to Settings -> Preferences, you can enable/disable inclusion of taxes in price calculations.</p>
  <img width="512" height="484" alt="Preferences settings showing the option to enable or disable tax inclusion in price calculations" src="https://github.com/user-attachments/assets/dce47778-d62f-477f-95c3-fb4e8d90f355" /><br>
<h3>Filter by min/max price</h3>
<p>If you do not wish to see all the items, you can set a minimum or a maximum price so that they are not shown/included in the total calculation</p>
<img width="303" height="88" alt="Price filter controls for setting minimum and maximum item values" src="https://github.com/user-attachments/assets/ddb5b962-5375-4980-ab16-f136cf15d386" />
</details>


<details>
  <summary><h2>How does it work?</h2></summary>
  <p>The program works by extracting data from a log file within the game files called UE_game.log, located in</p>
  <code>SteamLibrary\steamapps\common\Torchlight Infinite\UE_game\TorchLight\Saved\Logs.</code><br><br>
  <p>By enabling logging, we can extract updates that happen within the inventory, including price checking, sorting -> returning full inventory, or inventory updates by picking up loot.</p>
  <p>No memory reading or injection is used — all data is extracted from existing log output generated by the game.</p>
  <p>The program was written in TypeScript using Electron for UI, updates, etc...</p>
</details>
<details>
<summary><h2>Future Updates</h2></summary>
  <ul>
    <li>
      <b>Strategies</b> the ability to create a strategy, select what compasses are used, tree, etc.. and show FE/hr of that strategy with item breakdown.
    </li>
    <li>
      <b>Database</b> for item price checking syncing between users, making tracking prices even easier.
    </li>
  </ul>
</details>

<details>
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
