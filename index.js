const {rules, items, triggers, actions, cache} = require('openhab');

class AllyWrapper
{
    constructor(clientId, clientSecret)
    {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        // auth-discover rule

    }

    #hash(s) {
        return s.split("").reduce(function(a, b) {
          a = ((a << 5) - a) + b.charCodeAt(0);
          return "" + ( a & a);
        }, 0);
    }

    #token()
    {
        let token_key = this.#hash("allytoken_" + this.clientId + "_" + this.clientSecret);

        let token_payoad = cache.shared.get(token_key);

        let token = {token:null, ts:0};
        if (token_payoad !== null) token = JSON.parse(token_payoad)

        if ((token.ts === 0) || (token.ts <= Date.now())) {

            console.log("Refresh token");
            let auth_payload = new java.lang.String(this.clientId+":"+this.clientSecret);

            let response = JSON.parse(actions.HTTP.sendHttpPostRequest(
                "https://api.danfoss.com/oauth2/token", 
                "application/x-www-form-urlencoded;charset=UTF-8", 
                "grant_type=client_credentials", {
                    "Accept": "application/json",
                    "Authorization": "Basic " +java.util.Base64.Encoder.encodeToString(auth_payload.getBytes())
                },
                2000
            ));

            token.token = response.access_token;
            token.ts = Date.now() +  30*68*1000; // @tode expire in response

            cache.shared.put(token_key, JSON.stringify(token));
        }

        return token.token;
    }

    #device(device_info, force=false)
    {
        let device_group_name = items.safeItemName('DANFOSS_ALLY_'+device_info.id);

        let device_group = null;
        if (force || !(device_group = items.getItem(device_group_name, true))) {
            items.replaceItem({
                type: 'Group',
                name: device_group_name,
                label: device_info.name,
                groups: ['DANFOSS_ALLY']
            });
        }

        

        let device_property = null;
        ["online", "sub"].forEach(k => {
            let device_property_name = items.safeItemName('DANFOSS_ALLY_'+device_info.id+"_" + k.toUpperCase());

            //let device_property = null;
            if (force || !(device_property = items.getItem(device_property_name, true))) {
                console.log
                device_property = items.replaceItem({
                    type: 'Contact',
                    name: device_property_name,
                    label: device_info.name + " - " + k,
                    groups: [device_group_name]
                });
                
            }

            items.getItem(device_property_name).postUpdate(device_info[k] ? 'OPEN' : 'CLOSED');
        });

        ["active_time", "create_time", "update_time"].forEach(k => {
            let device_property_name = items.safeItemName('DANFOSS_ALLY_'+device_info.id+"_" + k.toUpperCase());

            //let device_property = null;
            if (force || !(device_property = items.getItem(device_property_name, true))) {
                device_property = items.replaceItem({
                    type: 'DateTime',
                    name: device_property_name,
                    label: device_info.name + " - " + k,
                    groups: [device_group_name]
                });
                
            }

            items.getItem(device_property_name).postUpdate(device_info[k]);
        });

        let exported_items = {};
        device_info['status'].forEach(status => {
            let type = 'String';
            let state = status.value;
            if (typeof status.value == "boolean") {
                type = 'Switch';
                state = status.value ? 'ON' : 'OFF'
            } else if (typeof status.value == "number") {
                type = 'Number';
                state = "" + status.value;
            }

            let device_property_name = items.safeItemName('DANFOSS_ALLY_'+device_info.id+"_STATUS_" + status.code.toUpperCase());

            //let device_property = null;
            if ((device_property = items.getItem(device_property_name, true)) === null) {
                device_property = items.replaceItem({
                    type: type,
                    name: device_property_name,
                    label: device_info.name + " - Status/" + status.code,
                    groups: [device_group_name]
                });               
            }

            exported_items[device_property_name] = [status.code, type];

            items.getItem(device_property_name).postUpdate(state);
        });

        return exported_items;
    }

    autoDiscover(devices, minutes=10)
    {
        rules.JSRule({
            name: "Discover Danfoss Ally devices",
            triggers: [
                triggers.GenericCronTrigger('0' + ' 0/' + minutes +' * ? * * *')
            ],
            overwrite: true,
            id: "discover_danfoss_ally",
            tags: ['DANFOSS_ALLY'],
            execute: event => {
                this.discover(devices, false);
            }
        });

        this.discover(devices, true);
    }

    discover(devices, force=false)
    {
        if (!items.getItem('DANFOSS_ALLY', true)) {
            items.replaceItem({
                type: 'Group',
                name: 'DANFOSS_ALLY',
                label: `Danfoss Ally™ API`
            });
        }
        this.devices().forEach(device_info => {
            const command_items = this.#device(device_info, force);            

            if ((devices === undefined) || devices.includes(device_info.id)) {
                rules.JSRule({
                    name: "Update Danfoss Ally device [" + device_info.id + "]",
                    triggers: [
                        triggers.GenericCronTrigger('0/15' + ' * * ? * * *')
                    ],
                    overwrite: true,
                    id: "update_"+device_info.id,
                    tags: ['DANFOSS_ALLY'],
                    execute: event => {
                        let updated_device_info = this.device(device_info.id);
                        this.#device(updated_device_info);
                    }
                });

                let command_triggers = [];
                for (const [item_name, item_code] of Object.entries(command_items)) {
                    command_triggers.push(triggers.ItemCommandTrigger(item_name))
                };

                rules.JSRule({
                    name: "Command Danfoss Ally device [" + device_info.id + "]",
                    triggers: command_triggers,
                    overwrite: true,
                    id: "command_"+device_info.id,
                    tags: ['DANFOSS_ALLY'],
                    execute: event => {
    
                        let value = event.receivedCommand;
                        if (command_items[event.itemName][1] == "Number") {
                            value = Math.round(value*1);
                        } else if (command_items[event.itemName][0] == "Switch") {
                            value = (value === 'ON');
                        }
    
                        this.commands(device_info.id, [
                            {
                                code: command_items[event.itemName][0],
                                value: value
                            }
                        ]);
                    }
                })
            } else {
                rules.removeRule("update_"+device_info.id);
                rules.removeRule("command_"+device_info.id);
            }
        });
    }

    commands(deviceId, commands)
    {
        const access_token = this.#token();

        if (access_token) {
            let response = JSON.parse(actions.HTTP.sendHttpPostRequest(
                "https://api.danfoss.com/ally/devices/" + deviceId + "/commands", 
                "application/json", 
                JSON.stringify({commands: commands}), {
                    "Accept": "application/json",
                    "Authorization": "Bearer " + access_token
                },
                2000
            ));

            return response.result;
        }
    }

    devices()
    {
        const access_token = this.#token();

        if (access_token) {
            let response = JSON.parse(actions.HTTP.sendHttpGetRequest("https://api.danfoss.com/ally/devices", {
                "Accept": "application/json",
                "Authorization": "Bearer " + access_token
            }, 5000));

            return response.result;
        }
    }

    device(deviceId)
    {
        const access_token = this.#token();

        if (access_token) {
            let response = JSON.parse(actions.HTTP.sendHttpGetRequest("https://api.danfoss.com/ally/devices/" + deviceId, {
                "Accept": "application/json",
                "Authorization": "Bearer " + access_token
            }, 5000));

            return response.result;
        }
    }
}

exports.client = (clientId, clientSecret) => {

    return new AllyWrapper(clientId, clientSecret);
}