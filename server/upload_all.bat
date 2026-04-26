@echo off
for /L %%i in (2,1,28) do (
    echo Uploading part %%i of 28...
    curl -X POST http://localhost:8080/global/upload -F "file=@legal_chunks/law_part_%%i.txt"
    echo Done with part %%i
    timeout /t 5
)
echo All parts uploaded!