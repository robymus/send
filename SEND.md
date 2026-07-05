I'd like a very easy file transfer app.

Let's generate a cute animal graphics as logo, like squirrel holding an envelope, and make this a prominent part of the design and screen real estate, as UI is going to be simple.

First page: authentication - just a simple input for one token, and the logo. The tokens for login are case insensitive.

I will have an admin token, this will be pregenerated (please generate it) and I will store it in my password manager. The name associated with it should be "Robert" (preinserted to database).

When I login as admin, I can

- create a new token
  - i can manually enter the token string or hit a button to autogenerate (autogenerate should generate 3 random words with a dash between)
  - i can enter a name, who will receive the token
  - i can enter a TTL (default 7 days)
  - then it will lead me to the token's page
- list all the tokens
  - clicking on them takes me to the tokens page
- when on a tokens page
  - i can see all files uploaded by me or uploaded by partner, who received the token - show file name and size
  - it shows who uploaded each file (by name), with upload time (in time order), maybe add a country flag based on the IP when the file was uploaded (for fun)
  - i can download them, and delete them
  - i can upload a new file under the token
  - i can update TTL (eg set days from now)

When someone else logins with their token:

- they see "Hello {name}", eg the name associated with the token
- they see the list of files, similar to the token page
- they can upload new files
- they can download files
- they can delete only their own uploaded files, not the files uploaded by admin

TTL:

- run a cleanup script daily, for every token whose TTL expired, delete the token and all associated files

That's it, all minimal. This will be used with other sidechannels, for example I send the link to someone on whatsapp and tell them the token, and ask to upload the file I need (or download something I sent them). They will tell me on this sidechannel that they have done it, so I can download it. Just to make transfer of files very easy.

Safety limit: let's limit file uploads to a maximum of 100M per token, by default, but let me change this limit on the admin page at token creation or later. when a new file is uploaded, check against this total limit, not per file. The limit includes files I've uploaded.
