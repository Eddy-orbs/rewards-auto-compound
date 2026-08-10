cd /home/orbsian/git/eddy-orbs/rewards-auto-compound/
set -o pipefail

DATE=$(date +"%Y%m%d")
FILE="log_$DATE.log"

TIME=$(date +"%T")
echo "START at $TIME" >> $FILE

npm run dev 2>&1 | tee -a $FILE
RUN_STATUS=$?

TIME2=$(date +"%T")
echo "FINISH at $TIME2" >> $FILE

exit $RUN_STATUS
