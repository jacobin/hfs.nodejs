# HFS: HTTP File Server

![logo and motto](hfs-logo-color-motto.svg)

## Introduction

HFS is the best way via web to access or share files from your disk.

- It's a server software, share files **fresh from your disk**. Don't rely on services, be independent! 
- It's all very **fast**. Try download zipping 100GB, it starts immediately!
- **Easy to use**. HFS tries to detect problems and suggest solutions.
- Share **even a single file** with our *virtual file system*, even with a different name, all without touching the real file. Present things the way you want!
- **Watch** all activities in real-time.
- **Control bandwidth**, decide how much to give.

This project is in an early stage, few things are missing, but it already rocks!

This is a full rewrite of [the Delphi version](https://github.com/rejetto/hfs2).
You won't find all previous features here (yet), but still we got:

## How does it work

- run HFS on your computer, configuration page automatically shows up
- select what files and folders you want to be accessible
- possibly create accounts and limit access to files
- access those files from a phone or another computer just using a browser

## Features

- https
- unicode
- virtual file system
- mobile friendly front-end
- search
- accounts
- resumable downloads
- download folders as zip archive
- simple website serving
- plug-ins
- log file
- speed throttler
- admin web interface
- virtual hosting (plug-in)
- anti-brute-force (plug-in)

## Installation

1. go to https://github.com/rejetto/hfs/releases
2. click on `Assets`
3. **download** the right version for your computer
4. launch `hfs` file
5. the browser should automatically open on `localhost` address, so you can configure the rest in the Admin panel.
   - if a browser cannot be opened on the computer where you are installing HFS, 
     you should enter this command in HFS console: `create-admin <PASSWORD>`

If you access *Admin panel* via localhost, by default HFS **won't** require your to login.
If you don't like this behavior, disable it in the Admin panel or enter this console command `config localhost_admin false`.

### Other systems

If your system is not Windows/Linux/Mac, you can try this alternative version:

0. [install node.js](https://nodejs.org)
1. execute: `sudo npm -g i hfs`
2. launch: `hfs`

Configuration and other files will be stored in `USER_HOME_FOLDER/.vfs`

With this installation method, you can update with `sudo npm -g update hfs` .

## Plug-ins

To install a plugin you just copy its folder inside `plugins` folder.

Delete it to uninstall.

HFS will ignore all folders with `-disabled` at the end of the name.

## Why you should upgrade from HFS 2.x to 3

As you can see from the list of features, we already have some goods that you cannot find in HFS 2.
Other than that, you can also consider: 

- it's more robust: it was designed to be an always-running server, while HFS 1-2 was designed for occasional usage (transfer and quit) 
- passwords are never really stored, just a non-reversible hash is
- more flexible permissions

But you may still want to stay with HFS 2.x (so far) for the following reasons

- smaller
- more tested
- classic window interface (can be easier for some people)

## Console commands

If you have access to HFS' console, you can enter commands. Start with `help` to have a full list. 

## Passing parameters

Any value you see in the config file with name *X* can be passed at command line in the form `--X <new_value>`,
or you can enter console command `config X <new_value>`.  

## License

[GPLv3](https://github.com/rejetto/hfs/blob/master/LICENSE.txt)
