@Controller('/api')
class AppController {
  @Get('/items')
  list() {}
}

class TodoStore {
  @observable
  todos = [];
}
