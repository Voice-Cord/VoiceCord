# VoiceCord
VoiceCord is a Discord bot designed to emulate the functionality of WhatsApp voice messages. Using a single command, users are able to record and send voice messages in any channel.


## Important
1. Contact me for the .env file, which contains the bot token.
2. If you run npm install it will fail.
Do the following to make it work for you.


### Settings up npm packages
1. Clone repo
2. Remove "canvas-webp" from package.json
3. Run npm install
4. Add "canvas.webp" back to package.json
5. Run npm install
6. IF IT DOESNT WORK: Follow these instructions: https://github.com/Automattic/node-canvas/wiki/#install-manually
    (For me, I only needed to download GTK2 and put the contents in: "C:\GTK")
7. Start over from step 5


If you have already tried to npm install, before removing "canvas-webp":
1. Remove all dependencies from package.json
2. Run npm prune
3. Do The steps in "Setting up npm packages"


### Folders
There is supposed to be a folder in the project root directory called, "recordings".
This folder has been added to .gitignore, meaning that folder will not get pushed to git.
So this means, you have to add this folder manually:


### Settings up Folderse
1. Go to the project root directory (The folder in which index.js is located in)
2. Create a folder called EXACTLY: "recordings"
