import mlflow.pyfunc

from .artifacts import load_artifact
from .contracts import QuestionInput
from .predictor import Predictor


class RegistryModel(mlflow.pyfunc.PythonModel):
    def load_context(self, context):
        self.predictor = Predictor(*load_artifact(context.artifacts["classifier"]))

    def predict(self, context, model_input, params=None):
        return [self.predictor.predict(QuestionInput.model_validate(row)).model_dump()
                for row in model_input.to_dict(orient="records")]
